"""book フォルダーの原稿から、Web版（静的サイト）を作る。

使い方:
    pip install -r site/requirements.txt
    python site/build.py                    # _site に出力（PHPの実行環境は自動で取得）
    python site/build.py --php-dir DIR      # 取得済みのPHPの実行環境を使う

出力した _site を GitHub Pages などに置けば公開できる。
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import sys
import urllib.request
from pathlib import Path

from markdown_it import MarkdownIt
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name
from pygments.util import ClassNotFound

ROOT = Path(__file__).resolve().parent.parent
BOOK = ROOT / 'book'
SITE = ROOT / 'site'

# ブラウザーでPHPを動かす実行環境（WordPress Playground の php-wasm、PHP 8.5.12、GPL-2.0-or-later）
PHP_WASM_COMMIT = '20d5e0ff23cdc2cd617b950ff131d7227c2668a0'
PHP_WASM_BASE = f'https://raw.githubusercontent.com/WordPress/wordpress-playground/{PHP_WASM_COMMIT}/packages/php-wasm/web-builds/8-5/asyncify'
PHP_WASM_FILES = {
    'php_8_5.js': 'e665625ac0054a9985944a5458f13f24ed109e75c667a097696945fa420f2ef9',
    '8_5_12/php_8_5.wasm': '6ad5fbac2f2fe3c074d97f2a8aa47422933343d341a6924b8c626ba122e33fce',
}

LANG_LABELS = {
    'php': 'PHP', 'bash': 'ターミナル', 'sh': 'シェル', 'js': 'JavaScript', 'jsx': 'JSX', 'json': 'JSON',
    'yaml': 'YAML', 'dotenv': '.env', 'dockerfile': 'Dockerfile', 'ini': 'ini', 'text': 'テキスト',
    'markdown': 'Markdown', 'xml': 'XML', 'http': 'HTTP', 'powershell': 'PowerShell',
}
FIXED_IDS = {'この章のゴール': 'goals', 'まとめ': 'summary', '演習': 'exercises', 'レビュー観点': 'review',
             'AIに頼むなら': 'ai'}
MEMO_KEYS = ('決めたこと', '選ばなかった案', '理由', '見直す条件')


# ---------- 原稿の読み込み ----------

def slug_of(stem: str) -> str:
    return 'introduction' if stem == '00-introduction' else stem


def load_chapters(content: dict) -> list[dict]:
    chapters = []
    for part in content['parts']:
        for stem in part['chapters']:
            text = (BOOK / f'{stem}.md').read_text(encoding='utf-8')
            # 章分けのときに付けた、GitHub用の前後リンク（最後の区切り線から後ろ）を外す
            text = re.sub(r'\n---\n\n\[[^\n]*\]\([^)]*\)[^\n]*\n*$', '\n', text)
            title = text.split('\n', 1)[0].lstrip('# ').strip()
            chapters.append({'stem': stem, 'slug': slug_of(stem), 'title': title, 'part': part['name'], 'markdown': text})
    return chapters


# ---------- Markdown から HTML へ ----------

def plain(text: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', text))).strip()


def lexer_for(lang: str, code: str):
    name = {'dotenv': 'bash', 'sh': 'bash'}.get(lang, lang or 'text')
    if lang in ('bash', 'sh') and re.search(r'^\$ ', code, re.M):
        name = 'console'
    options = {'stripnl': False}
    if name == 'php' and not code.lstrip().startswith('<?php'):
        options['startinline'] = True
    try:
        return get_lexer_by_name(name, **options)
    except ClassNotFound:
        return get_lexer_by_name('text')


def is_http_block(lang: str, code: str) -> bool:
    if lang not in ('bash', 'sh'):
        return False
    curls = re.findall(r'^\$ curl\s.*$', code, re.M)
    assigns = re.findall(r'^\$ [A-Z_][A-Z0-9_]*=', code, re.M)
    return bool(assigns) or any(('localhost' in c or 'https://' in c) and '| bash' not in c for c in curls)


class Renderer:
    def __init__(self, content: dict, chapters: list[dict], repo_url: str | None):
        self.content = content
        self.chapters = chapters
        self.repo_url = repo_url
        self.slugs = {c['stem']: c['slug'] for c in chapters}
        self.md = MarkdownIt('commonmark', {'html': False, 'linkify': False, 'typographer': False})
        self.md.enable(['table', 'strikethrough'])
        self.md.add_render_rule('fence', self.render_fence)
        self.formatter = HtmlFormatter(nowrap=True)

    # コードの塊：言語の表示、ハイライト、実行やコピーのボタンを置く場所
    def render_fence(self, tokens, idx, options, env):
        token = tokens[idx]
        lang = (token.info or '').split()[0] if token.info else ''
        code = token.content
        if lang == 'mermaid':
            return self.render_mermaid(code)
        attrs = [f'data-lang="{html.escape(lang or "text")}"']
        if lang == 'php':
            env['php_index'] += 1
            if env['php_index'] in self.content['runnable_php'].get(env['stem'], []):
                attrs.append('data-run="php"')
        elif is_http_block(lang, code):
            attrs.append('data-run="http"')
        highlighted = highlight(code, lexer_for(lang, code), self.formatter)
        label = LANG_LABELS.get(lang, lang or 'テキスト')
        return (f'<div class="code" {" ".join(attrs)}><div class="code-bar"><span class="code-lang">{html.escape(label)}</span>'
                f'<span class="code-actions"></span></div><pre><code>{highlighted}</code></pre></div>\n')

    def render_mermaid(self, code: str) -> str:
        key = hashlib.sha1(code.encode()).hexdigest()[:12]
        light = SITE / 'diagrams' / f'{key}-light.svg'
        dark = SITE / 'diagrams' / f'{key}-dark.svg'
        if light.exists() and dark.exists():
            self.diagrams.update({light.name, dark.name})
            labels = re.findall(r'\["([^"]+)"\]|\[\("([^"]+)"\)\]', code)
            alt = '、'.join(a or b for a, b in labels).replace('<br>', ' ')
            return (f'<figure class="diagram"><img class="for-light" src="{self.root}assets/diagrams/{light.name}" alt="{html.escape(alt)}">'
                    f'<img class="for-dark" src="{self.root}assets/diagrams/{dark.name}" alt="{html.escape(alt)}"></figure>\n')
        return f'<pre class="mermaid">{html.escape(code)}</pre>\n'

    def assign_ids(self, tokens) -> list[dict]:
        sections = []
        used = set()
        h2_id = None
        counters = {'h2': 0, 'h3': 0}
        for i, token in enumerate(tokens):
            if token.type != 'heading_open':
                continue
            text = tokens[i + 1].content
            if token.tag == 'h2':
                counters['h2'] += 1
                m = re.match(r'^(\d+)\.(\d+)\s', text)
                a = re.match(r'^付録([A-Z])\s', text)
                ident = f's{m.group(1)}-{m.group(2)}' if m else f'appendix-{a.group(1).lower()}' if a else FIXED_IDS.get(text, f'sec-{counters["h2"]}')
                h2_id = ident
                counters['h3'] = 0
                sections.append({'id': ident, 'title': text})
            elif token.tag == 'h3':
                counters['h3'] += 1
                ident = f'{h2_id or "top"}-{counters["h3"]}'
            else:
                continue
            while ident in used:
                ident += '-x'
            used.add(ident)
            token.attrSet('id', ident)
        return sections

    def rewrite_links(self, tokens):
        for token in tokens:
            for child in token.children or []:
                if child.type != 'link_open':
                    continue
                href = child.attrGet('href') or ''
                m = re.match(r'^(?:\.\./book/|\./)?([0-9a-z-]+)\.md(#.*)?$', href)
                if m and m.group(1) in self.slugs:
                    child.attrSet('href', f'{self.root}{self.slugs[m.group(1)]}/{m.group(2) or ""}')
                elif href.startswith('../') and self.repo_url:
                    child.attrSet('href', f'{self.repo_url}/blob/main/{href[3:]}')
                elif re.match(r'^https?://', href):
                    child.attrSet('target', '_blank')
                    child.attrSet('rel', 'noopener')

    def render(self, chapter: dict, root: str) -> dict:
        self.root = root
        self.diagrams = set()
        env = {'stem': chapter['stem'], 'php_index': 0}
        tokens = self.md.parse(chapter['markdown'], env)
        sections = self.assign_ids(tokens)
        self.rewrite_links(tokens)
        # 表は横にはみ出してもページ全体が横に動かないよう、枠で包む
        body = self.md.renderer.render(tokens, self.md.options, env)
        body = body.replace('<table>', '<div class="table-wrap"><table>').replace('</table>', '</table></div>')
        body = self.decorate_callouts(body)
        body = self.insert_playground(chapter, body)
        # 1行目の h1 は、ページの見出しとして別に組む
        body = re.sub(r'^<h1>.*?</h1>\n', '', body, count=1)
        return {'html': body, 'sections': sections}

    def decorate_callouts(self, body: str) -> str:
        def callout(m):
            kind, rest = m.group(1), m.group(2)
            cls = 'callout-pit' if kind == 'つまずきポイント' else 'callout-memo'
            return (f'<blockquote class="callout {cls}">\n<p class="callout-title"><span class="callout-kind">{kind}</span>'
                    f'<span class="callout-name">{rest}</span></p>')
        body = re.sub(r'<blockquote>\n<p>(つまずきポイント|設計判断メモ)：(.*?)</p>', callout, body)
        keys = '|'.join(MEMO_KEYS)
        return re.sub(rf'<p>({keys})：', r'<p><span class="memo-key">\1</span>', body)

    def insert_playground(self, chapter: dict, body: str) -> str:
        heading = self.content.get('php_playground', {}).get(chapter['stem'])
        if not heading:
            return body
        label = heading.lstrip('# ')
        sample = '<?php\n\n// ここに演習のコードを書いて「実行」を押します（Ctrl＋Enter でも実行できます）\necho "こんにちは、PHP " . PHP_VERSION;\n'
        block = ('<div class="playground"><p class="playground-lead">この演習は、下の入力欄で書いて試せます。書いたコードはこのページを閉じると消えます。</p>'
                 f'<div class="code" data-lang="php" data-run="php" data-playground><div class="code-bar"><span class="code-lang">PHP（自由に試す）</span>'
                 f'<span class="code-actions"></span></div><pre><code>{html.escape(sample)}</code></pre></div></div>\n')
        # 演習の節の終わり（次の h2 の直前）に置く
        m = re.search(rf'<h2 id="[^"]+">{re.escape(label)}</h2>(.*?)(?=<h2 |\Z)', body, re.S)
        if not m:
            return body
        return body[:m.end(1)] + block + body[m.end(1):]


# ---------- ページの組み立て ----------

EARLY = ("<script>try{var d=document.documentElement,t=localStorage.getItem('tb-theme');if(t)d.dataset.theme=t;"
         "d.dataset.mode=localStorage.getItem('tb-mode')||'browser'}catch(e){document.documentElement.dataset.mode='browser'}</script>")


def head(title: str, root: str, description: str) -> str:
    return f'''<!doctype html>
<html lang="ja" data-mode="browser">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="{html.escape(description)}">
<meta name="tb-root" content="{root}">
<title>{html.escape(title)}</title>
{EARLY}
<link rel="stylesheet" href="{root}assets/book.css">
<link rel="icon" href="{root}assets/favicon.svg" type="image/svg+xml">
<script type="module" src="{root}assets/js/book.js"></script>
</head>
'''


def header(content: dict, root: str, repo_url: str | None) -> str:
    repo = (f'<a class="icon-link" href="{repo_url}" target="_blank" rel="noopener" title="GitHubのリポジトリ" aria-label="GitHubのリポジトリ">'
            '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>') if repo_url else ''
    return f'''<header class="site-header">
  <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="sidebar" aria-label="目次を開く"><span></span></button>
  <a class="site-title" href="{root}index.html"><span class="site-title-full">{html.escape(content["title"])}</span><span class="site-title-short">Web APIの作り方</span></a>
  <div class="search" role="search">
    <label class="visually-hidden" for="search">本文を検索</label>
    <input id="search" type="search" placeholder="検索" title="/ キーで、ここに移動できます" autocomplete="off">
    <div class="search-results" hidden></div>
  </div>
  <div class="mode-switch" role="group" aria-label="試し方">
    <button type="button" data-mode-value="browser" aria-pressed="true"><span class="long">ブラウザーだけで試す</span><span class="short">ブラウザー</span></button>
    <button type="button" data-mode-value="local" aria-pressed="false"><span class="long">手元の環境で試す</span><span class="short">手元</span></button>
  </div>
  <button class="theme-toggle icon-link" type="button" aria-label="暗い表示にする"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/></svg></button>
  {repo}
</header>
'''


def sidebar(content: dict, chapters: list[dict], current: dict | None, sections: list[dict], root: str) -> str:
    by_stem = {c['stem']: c for c in chapters}
    parts = []
    for part in content['parts']:
        items = []
        for stem in part['chapters']:
            c = by_stem[stem]
            active = current is not None and c['stem'] == current['stem']
            sub = ''
            if active and sections:
                sub = '<ol class="nav-sections">' + ''.join(
                    f'<li><a href="#{s["id"]}">{html.escape(s["title"])}</a></li>' for s in sections) + '</ol>'
            items.append(f'<li{" class=is-current" if active else ""}><a href="{root}{c["slug"]}/"'
                         f'{" aria-current=page" if active else ""}>{html.escape(c["title"])}</a>{sub}</li>')
        heading = f'<p class="nav-part">{html.escape(part["name"])}</p>' if part['name'] else ''
        parts.append(f'<div class="nav-group">{heading}<ul>{"".join(items)}</ul></div>')
    return (f'<nav class="sidebar" id="sidebar" aria-label="目次"><a class="nav-home" href="{root}index.html">表紙と使い方</a>'
            f'{"".join(parts)}</nav><div class="sidebar-scrim"></div>')


def mode_guide(guide: dict | None) -> str:
    if not guide:
        return ''
    def items(key):
        return ''.join(f'<li>{html.escape(t)}</li>' for t in guide[key])
    return f'''<aside class="mode-guide" aria-label="この章の進め方">
  <p class="mode-guide-title">この章の進め方</p>
  <div class="mode-guide-cols">
    <section class="mode-col" data-for="browser"><h2 class="mode-col-title"><span class="mode-dot"></span>ブラウザーだけで</h2><ul>{items("browser")}</ul></section>
    <section class="mode-col" data-for="local"><h2 class="mode-col-title"><span class="mode-dot"></span>手元の環境で</h2><ul>{items("local")}</ul></section>
  </div>
  <p class="mode-guide-note">上の切り替えで、いまの状況に合う進め方を選べます。選んだ進め方は、ほかの章でも引き継がれます。</p>
</aside>
'''


def footer(root: str, repo_url: str | None) -> str:
    repo = f'<a href="{repo_url}" target="_blank" rel="noopener">GitHubのリポジトリ</a>・' if repo_url else ''
    return f'''<footer class="site-footer">
  <p>{repo}<a href="{root}index.html#how-to-use">Web版の使い方</a></p>
  <p class="credits">ブラウザーでのPHPの実行には、<a href="https://github.com/WordPress/wordpress-playground" target="_blank" rel="noopener">WordPress Playground</a> の php-wasm（GPL-2.0-or-later）を使っています。APIの「試す」は、ブラウザーの中で動く模擬APIか、手元で動かしているAPIに送ります。</p>
</footer>
'''


def chapter_page(content, chapters, i, rendered, repo_url) -> str:
    c = chapters[i]
    root = '../'
    prev_c = chapters[i - 1] if i > 0 else None
    next_c = chapters[i + 1] if i + 1 < len(chapters) else None
    pager = '<nav class="pager" aria-label="前後の章">'
    pager += (f'<a class="pager-prev" href="{root}{prev_c["slug"]}/"><span class="pager-dir">前の章</span>'
              f'<span class="pager-title">{html.escape(prev_c["title"])}</span></a>') if prev_c else '<span></span>'
    pager += (f'<a class="pager-next" href="{root}{next_c["slug"]}/"><span class="pager-dir">次の章</span>'
              f'<span class="pager-title">{html.escape(next_c["title"])}</span></a>') if next_c else '<span></span>'
    pager += '</nav>'
    toc = ''
    if rendered['sections']:
        toc = ('<aside class="page-toc" aria-label="このページの内容"><p class="page-toc-title">このページの内容</p><ol>'
               + ''.join(f'<li><a href="#{s["id"]}">{html.escape(s["title"])}</a></li>' for s in rendered['sections'])
               + '</ol></aside>')
    eyebrow = f'<p class="eyebrow">{html.escape(c["part"])}</p>' if c['part'] else ''
    description = f'{c["title"]}｜{content["title"]}'
    return (head(f'{c["title"]}｜{content["title"]}', root, description) + '<body>\n' + header(content, root, repo_url)
            + '<div class="layout">' + sidebar(content, chapters, c, rendered['sections'], root)
            + f'<main class="content" id="main"><article class="chapter">{eyebrow}<h1 class="chapter-title">{html.escape(c["title"])}</h1>'
            + mode_guide(content['guide'].get(c['stem'])) + rendered['html'] + '</article>' + pager + footer(root, repo_url) + '</main>'
            + toc + '</div>\n</body>\n</html>\n')


def index_page(content, chapters, repo_url, lead: str) -> str:
    root = ''
    by_stem = {c['stem']: c for c in chapters}
    toc = []
    for part in content['parts']:
        items = ''.join(f'<li><a href="{by_stem[s]["slug"]}/">{html.escape(by_stem[s]["title"])}</a></li>' for s in part['chapters'])
        name = f'<h3>{html.escape(part["name"])}</h3>' if part['name'] else ''
        toc.append(f'<div class="toc-part">{name}<ol>{items}</ol></div>')
    first = chapters[0]
    return (head(content['title'], root, content['subtitle']) + '<body class="is-cover">\n' + header(content, root, repo_url)
            + '<div class="layout">' + sidebar(content, chapters, None, [], root) + f'''<main class="content" id="main">
<section class="cover">
  <p class="cover-kicker">TaskBoard API を作りながら学ぶ</p>
  <h1 class="cover-title">{html.escape(content["title"])}</h1>
  <p class="cover-subtitle">{html.escape(content["subtitle"])}</p>
  <p class="cover-lead">{html.escape(lead)}</p>
  <div class="cover-actions"><a class="btn btn-primary" href="{first["slug"]}/">「はじめに」から読む</a><a class="btn btn-quiet" href="#contents">目次を見る</a></div>
  <div class="cover-terminal" aria-hidden="true"><span class="t-prompt">$</span> curl -i http://localhost/api/v1/tasks/46 -H "Authorization: Bearer $TOKEN"<br><span class="t-status">HTTP/1.1 200 OK</span><br>ETag: "v1"<br>{{"data":{{"id":46,"title":"仕様をまとめる","version":1,…}}}}</div>
</section>
<section class="how-to-use" id="how-to-use">
  <h2>Web版の使い方</h2>
  <p>本文を読みながら、その場でコードを動かせます。いまの状況に合わせて、試し方を選んでください。選んだ試し方は、画面上部の切り替えでいつでも変えられます。</p>
  <div class="mode-cards">
    <button type="button" class="mode-card" data-mode-value="browser" aria-pressed="true">
      <span class="mode-card-title"><span class="mode-dot"></span>ブラウザーだけで試す</span>
      <span class="mode-card-text">インストールは要りません。PHPのコードはブラウザーの中のPHP 8.5で動き、APIの例は、本書の完成版と同じ動きをする模擬APIに送ります。</span>
      <span class="mode-card-need">必要なもの：最近のブラウザー（パソコン推奨）</span>
    </button>
    <button type="button" class="mode-card" data-mode-value="local" aria-pressed="false">
      <span class="mode-card-title"><span class="mode-dot"></span>手元の環境で試す</span>
      <span class="mode-card-text">第3章の手順で作った環境（Sail）で、自分で書いたAPIを動かします。本文のAPIの例は、手元のAPI（http://localhost）に送ります。</span>
      <span class="mode-card-need">必要なもの：Docker Desktop、ターミナル</span>
    </button>
  </div>
  <div class="feature-list">
    <div><h3>PHPを実行する</h3><p>第2章のコードにある「実行」で、結果がその場に表示されます。「編集」で書き換えて試せます。</p></div>
    <div><h3>APIをその場で試す</h3><p>curl の例にある「試す」で、リクエストを送って、ステータスコード、ヘッダー、JSONを確かめられます。</p></div>
    <div><h3>章ごとの進め方</h3><p>各章の冒頭に、ブラウザーだけでできることと、手元の環境でできることをまとめています。</p></div>
  </div>
</section>
<section class="contents" id="contents"><h2>目次</h2><div class="toc-grid">{"".join(toc)}</div></section>
''' + footer(root, repo_url) + '</main></div>\n</body>\n</html>\n')


def not_found_page(content, chapters, repo_url) -> str:
    root = '/' if os.environ.get('GITHUB_REPOSITORY') is None else f'/{os.environ["GITHUB_REPOSITORY"].split("/")[1]}/'
    return (head(f'ページが見つかりません｜{content["title"]}', root, content['subtitle']) + '<body>\n' + header(content, root, repo_url)
            + '<div class="layout">' + sidebar(content, chapters, None, [], root)
            + f'<main class="content"><article class="chapter"><h1 class="chapter-title">ページが見つかりません</h1>'
            f'<p>URLが変わったか、ページが移動した可能性があります。<a href="{root}index.html">表紙と目次</a>から探してください。</p></article>'
            + footer(root, repo_url) + '</main></div>\n</body>\n</html>\n')


# ---------- PHPの実行環境 ----------

def fetch_php(php_dir: Path | None, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for name, digest in PHP_WASM_FILES.items():
        target = dest / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if php_dir:
            shutil.copyfile(php_dir / name, target)
        else:
            print(f'download {name}', file=sys.stderr)
            with urllib.request.urlopen(f'{PHP_WASM_BASE}/{name}', timeout=120) as res:
                target.write_bytes(res.read())
        actual = hashlib.sha256(target.read_bytes()).hexdigest()
        if actual != digest:
            raise SystemExit(f'{name} の内容が想定と違います（sha256 {actual}）')


# ---------- 検索用の索引 ----------

def search_entries(chapter: dict, body: str) -> list[dict]:
    entries = []
    parts = re.split(r'(<h2 id="[^"]+">.*?</h2>)', body)
    current = {'id': '', 'title': chapter['title']}
    text = parts[0]
    for piece in parts[1:]:
        m = re.match(r'<h2 id="([^"]+)">(.*?)</h2>', piece)
        if m:
            entries.append((current, text))
            current = {'id': m.group(1), 'title': plain(m.group(2))}
            text = ''
        else:
            text += piece
    entries.append((current, text))
    out = []
    for sec, raw in entries:
        x = plain(raw)
        if not x and not sec['id']:
            continue
        out.append({'c': chapter['title'], 'h': sec['title'], 'u': f'{chapter["slug"]}/' + (f'#{sec["id"]}' if sec['id'] else ''), 'x': x[:6000]})
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description='Web版を作る')
    parser.add_argument('--out', default=str(ROOT / '_site'))
    parser.add_argument('--php-dir', default=None, help='取得済みの php_8_5.js と 8_5_12/php_8_5.wasm があるフォルダー')
    parser.add_argument('--no-php', action='store_true', help='PHPの実行環境を入れない（確認用）')
    args = parser.parse_args()

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    content = json.loads((SITE / 'content.json').read_text(encoding='utf-8'))
    repo = os.environ.get('GITHUB_REPOSITORY')
    repo_url = os.environ.get('BOOK_REPO_URL') or (f'https://github.com/{repo}' if repo else None)
    chapters = load_chapters(content)
    renderer = Renderer(content, chapters, repo_url)

    shutil.copytree(SITE / 'assets', out / 'assets')
    (out / 'assets' / 'diagrams').mkdir(parents=True, exist_ok=True)
    for svg in (SITE / 'diagrams').glob('*.svg'):
        shutil.copyfile(svg, out / 'assets' / 'diagrams' / svg.name)
    if not args.no_php:
        fetch_php(Path(args.php_dir) if args.php_dir else None, out / 'assets' / 'php')

    index = []
    for i, chapter in enumerate(chapters):
        rendered = renderer.render(chapter, '../')
        page = out / chapter['slug'] / 'index.html'
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text(chapter_page(content, chapters, i, rendered, repo_url), encoding='utf-8')
        index.extend(search_entries(chapter, rendered['html']))

    lead = re.search(r'\n\n(本書のゴールは.*?)\n', chapters[0]['markdown'])
    (out / 'index.html').write_text(index_page(content, chapters, repo_url, lead.group(1) if lead else content['subtitle']), encoding='utf-8')
    (out / '404.html').write_text(not_found_page(content, chapters, repo_url), encoding='utf-8')
    (out / 'search-index.json').write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (out / '.nojekyll').write_text('', encoding='utf-8')
    print(f'{len(chapters)} pages, {len(index)} search entries -> {out}')


if __name__ == '__main__':
    main()
