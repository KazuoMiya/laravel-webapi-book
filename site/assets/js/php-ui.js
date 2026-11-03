// 本文のPHPのコードに「実行」と「編集」を付ける。PHPはブラウザーの中（ワーカー）で動く
let runnerPromise = null;
let loadedOnce = false;

function runner() {
  runnerPromise ??= import(new URL('../php/php-runner.js', import.meta.url).href);
  return runnerPromise;
}

function prepare(code) {
  // 本文には <?php を省いた断片もあるので、行番号が変わらないよう1行目の前に足す
  return code.trimStart().startsWith('<?php') ? code : `<?php ${code}`;
}

export function mountPhp(block, { editable = false, initial = null } = {}) {
  const pre = block.querySelector('pre');
  const codeEl = block.querySelector('code');
  const original = initial ?? codeEl.textContent;
  const actions = block.querySelector('.code-actions');
  const output = document.createElement('div');
  output.className = 'php-output';
  output.setAttribute('aria-live', 'polite');
  output.hidden = true;
  block.after(output);

  let editor = null;
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'btn btn-run';
  runBtn.textContent = '実行';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-quiet';
  editBtn.textContent = '編集';
  actions.prepend(runBtn, editBtn);

  function openEditor() {
    editor = document.createElement('textarea');
    editor.className = 'php-editor';
    editor.spellcheck = false;
    editor.value = codeEl.textContent;
    editor.setAttribute('aria-label', 'PHPのコード（書き換えて実行できます）');
    const fit = () => { editor.style.height = 'auto'; editor.style.height = `${editor.scrollHeight + 4}px`; };
    editor.addEventListener('input', fit);
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end');
      }
    });
    pre.hidden = true;
    pre.after(editor);
    fit();
    editBtn.textContent = '元に戻す';
    block.classList.add('is-editing');
  }

  function closeEditor() {
    editor?.remove();
    editor = null;
    pre.hidden = false;
    editBtn.textContent = '編集';
    block.classList.remove('is-editing');
  }

  editBtn.addEventListener('click', () => {
    if (editor) {
      closeEditor();
      codeEl.textContent = original;
      output.hidden = true;
    } else {
      openEditor();
    }
  });

  async function run() {
    const code = editor ? editor.value : codeEl.textContent;
    runBtn.disabled = true;
    output.hidden = false;
    output.className = 'php-output is-running';
    output.textContent = loadedOnce
      ? '実行しています…'
      : 'PHPの実行環境を読み込んでいます。初回だけ約21MBを読み込むため、少し時間がかかります…';
    const started = performance.now();
    try {
      const { runPHP } = await runner();
      const result = await runPHP(prepare(code));
      loadedOnce = true;
      output.replaceChildren();
      const head = document.createElement('div');
      head.className = 'php-output-head';
      const body = document.createElement('pre');
      body.className = 'php-output-body';
      if (result.timeout) {
        output.className = 'php-output is-error';
        head.textContent = '10秒たっても終わらなかったので止めました';
        body.textContent = '無限ループになっていないかを確かめてください。';
      } else if (result.error) {
        output.className = 'php-output is-error';
        head.textContent = 'PHPを動かせませんでした';
        body.textContent = result.error;
      } else {
        const failed = result.exitCode !== 0 || /\n(Fatal error|Parse error):/.test(result.output);
        output.className = `php-output ${failed ? 'is-error' : 'is-ok'}`;
        head.textContent = `出力（PHP 8.5・${Math.round(performance.now() - started)}ms${failed ? '・エラーで終了' : ''}）`;
        body.textContent = result.output === '' ? '（何も出力されませんでした）' : result.output.replace(/^\n/, '');
      }
      output.append(head, body);
      if (document.documentElement.dataset.mode === 'local') {
        const tip = document.createElement('p');
        tip.className = 'php-output-tip';
        tip.textContent = '手元で試すときは、ファイルに保存して、第2章の冒頭の docker run のコマンドか sail php ファイル名.php で実行します。';
        output.append(tip);
      }
    } catch (error) {
      output.className = 'php-output is-error';
      output.textContent = `PHPの実行環境を読み込めませんでした（${error.message}）。ページを再読み込みして、もう一度試してください。`;
    } finally {
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener('click', run);
  if (editable) openEditor();
}
