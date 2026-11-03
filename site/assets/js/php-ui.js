// 本文のPHPのコードに「実行」と「編集」を付ける。PHPはブラウザーの中（ワーカー）で動く
let runnerPromise = null;

function runner() {
  runnerPromise ??= import(new URL('../php/php-runner.js', import.meta.url).href);
  return runnerPromise;
}

const mb = (bytes) => (bytes / 1e6).toFixed(1);

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

  function button(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-quiet';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // 実行環境の読み込み中の表示。進み具合と、取りやめるボタンを出す
  function showLoading(r, cancel) {
    output.className = 'php-output is-running';
    const box = document.createElement('div');
    box.className = 'php-load';
    const text = document.createElement('p');
    text.className = 'php-load-text';
    text.textContent = 'PHPの実行環境を読み込んでいます。初回だけ約21MBを読み込みます。';
    const bar = document.createElement('progress');
    bar.className = 'php-load-bar';
    const actions = document.createElement('div');
    actions.className = 'php-load-actions';
    actions.append(button('取りやめる', cancel));
    box.append(text, bar, actions);
    output.replaceChildren(box);
    return r.onProgress(({ loaded, total }) => {
      bar.max = total;
      bar.value = loaded;
      text.textContent = loaded >= total
        ? 'PHPの実行環境を起動しています…'
        : `PHPの実行環境を読み込んでいます（${mb(loaded)}MB／${mb(total)}MB）。初回だけで、次からは読み込みません。`;
    });
  }

  function showResult(result, cancelledByReader) {
    output.replaceChildren();
    const head = document.createElement('div');
    head.className = 'php-output-head';
    const body = document.createElement('pre');
    body.className = 'php-output-body';
    output.append(head, body);
    if (result.cancelled) {
      output.className = 'php-output is-error';
      head.textContent = cancelledByReader ? '読み込みを取りやめました' : '実行を取りやめました';
      body.textContent = cancelledByReader
        ? '通信量が気になるときは、Wi-Fiにつないでから試すか、第2章の手順で手元のPHPを使ってください。'
        : 'ほかのコードが時間切れで止められたため、このコードも止まりました。もう一度実行してください。';
      output.append(retryRow('もう一度実行する'));
      return;
    }
    if (result.timeout) {
      output.className = 'php-output is-error';
      head.textContent = '10秒たっても終わらなかったので止めました';
      body.textContent = '無限ループになっていないかを確かめてください。次に実行するときは、実行環境を読み込み直します。';
      return;
    }
    if (result.error) {
      output.className = 'php-output is-error';
      head.textContent = 'PHPを動かせませんでした';
      body.textContent = result.error;
      output.append(retryRow('もう一度試す'));
      return;
    }
    const failed = result.exitCode !== 0 || /\n(Fatal error|Parse error):/.test(result.output);
    output.className = `php-output ${failed ? 'is-error' : 'is-ok'}`;
    head.textContent = `出力（PHP 8.5・${Math.round(result.elapsed ?? 0)}ms${failed ? '・エラーで終了' : ''}）`;
    let text = result.output === '' ? '（何も出力されませんでした）' : result.output.replace(/^\n/, '');
    if (result.truncated) text += '\n\n（出力が長すぎるため、ここから先は省きました）';
    body.textContent = text;
    if (document.documentElement.dataset.mode === 'local') {
      const tip = document.createElement('p');
      tip.className = 'php-output-tip';
      tip.textContent = '手元で試すときは、ファイルに保存して、第2章の冒頭の docker run のコマンドか sail php ファイル名.php で実行します。';
      output.append(tip);
    }
  }

  function retryRow(label) {
    const row = document.createElement('div');
    row.className = 'php-output-actions';
    row.append(button(label, run));
    return row;
  }

  async function run() {
    if (runBtn.disabled) return;
    const code = editor ? editor.value : codeEl.textContent;
    runBtn.disabled = true;
    output.hidden = false;
    let cancelledByReader = false;
    let stopListening = () => {};
    try {
      const r = await runner();
      if (r.isReady()) {
        output.className = 'php-output is-running';
        output.textContent = '実行しています…';
      } else {
        stopListening = showLoading(r, () => { cancelledByReader = true; r.cancelLoading(); });
        r.preload().then(() => {
          stopListening();
          if (output.classList.contains('is-running')) output.textContent = '実行しています…';
        }, () => {});
      }
      const result = await r.runPHP(prepare(code));
      showResult(result, cancelledByReader);
    } catch (error) {
      output.className = 'php-output is-error';
      output.textContent = `PHPの実行環境を読み込めませんでした（${error.message}）。ページを再読み込みして、もう一度試してください。`;
    } finally {
      stopListening();
      runBtn.disabled = false;
    }
  }

  // マウスを「実行」に重ねたら、押される前に読み込みを始めておく（データ節約の設定のときはしない）
  let warmTimer = null;
  runBtn.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' || navigator.connection?.saveData) return;
    warmTimer = setTimeout(() => runner().then((r) => r.preload()).catch(() => {}), 250);
  });
  runBtn.addEventListener('pointerleave', () => clearTimeout(warmTimer));

  runBtn.addEventListener('click', run);
  if (editable) openEditor();
}
