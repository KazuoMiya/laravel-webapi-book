// 本文のコマンドの例（$ で始まる行）を読み取り、curl の指定をリクエストに変換する

// コードの塊を、実行できる単位（コマンド）に分ける
export function splitCommands(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const entries = [];
  let comment = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) { comment = line.replace(/^\s*#\s?/, ''); continue; }
    if (!line.startsWith('$ ')) continue;   // 先頭が $ でない行は、表示例（出力）
    let command = line.slice(2);
    while (/\\\s*$/.test(command) && i + 1 < lines.length) {
      command = `${command.replace(/\\\s*$/, '')}\n${lines[++i].replace(/^\s+/, '    ')}`;
    }
    entries.push({ kind: classify(command), label: comment, text: command.trim() });
    comment = '';
  }
  return entries;
}

function classify(command) {
  if (/^[A-Z_][A-Z0-9_]*=/.test(command)) return 'assign';
  if (/^curl\s/.test(command) && !/\|\s*\w/.test(command)) return 'curl';
  return 'other';
}

// シェルと同じように、引用符と変数（$TOKEN、${TOKEN}）を処理して単語に分ける
export function shellWords(input, vars) {
  const words = [];
  let current = '';
  let started = false;
  const missing = new Set();
  const expand = (name) => {
    if (vars[name] === undefined || vars[name] === '') missing.add(name);
    return vars[name] ?? '';
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\\' && input[i + 1] === '\n') { i++; continue; }
    if (/\s/.test(c)) {
      if (started) { words.push(current); current = ''; started = false; }
      continue;
    }
    started = true;
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) throw new Error('閉じていない引用符（\'）があります。');
      current += input.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && ['"', '\\', '$', '`'].includes(input[i + 1])) { current += input[i + 1]; i += 2; continue; }
        if (input[i] === '$') {
          const m = input.slice(i).match(/^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/);
          if (m) { current += expand(m[1] ?? m[2]); i += m[0].length; continue; }
        }
        current += input[i++];
      }
      if (i >= input.length) throw new Error('閉じていない引用符（"）があります。');
    } else if (c === '$') {
      const m = input.slice(i).match(/^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/);
      if (m) { current += expand(m[1] ?? m[2]); i += m[0].length - 1; } else current += c;
    } else if (c === '\\') {
      current += input[++i] ?? '';
    } else {
      current += c;
    }
  }
  if (started) words.push(current);
  return { words, missing: [...missing] };
}

// curl の引数をリクエストの内容に変換する
export function parseCurl(command, vars) {
  const { words, missing } = shellWords(command, vars);
  if (words[0] !== 'curl') throw new Error('curl のコマンドではありません。');
  const request = { method: null, url: null, headers: {}, body: null, include: false, missing };
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const next = () => {
      if (i + 1 >= words.length) throw new Error(`${w} の後に値がありません。`);
      return words[++i];
    };
    if (w === '-i' || w === '--include' || w === '-v' || w === '--verbose') request.include = true;
    else if (/^-[sSLk]+$/.test(w) || ['--silent', '--show-error', '--location', '--compressed'].includes(w)) { /* 表示だけの指定は無視する */ }
    else if (/^-[sS]*i[sS]*$/.test(w)) request.include = true;
    else if (w === '-X' || w === '--request') request.method = next().toUpperCase();
    else if (w.startsWith('-X') && w.length > 2) request.method = w.slice(2).toUpperCase();
    else if (w === '-H' || w === '--header') {
      const h = next();
      const idx = h.indexOf(':');
      if (idx > 0) request.headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    } else if (['-d', '--data', '--data-raw', '--data-binary'].includes(w)) {
      const d = next();
      request.body = request.body ? `${request.body}&${d}` : d;
    } else if (w === '--json') {
      request.body = next();
      request.headers['Content-Type'] ??= 'application/json';
      request.headers.Accept ??= 'application/json';
    } else if (w === '--url') request.url = next();
    else if (w.startsWith('-')) throw new Error(`この画面では ${w} の指定に対応していません。`);
    else if (!request.url) request.url = w;
  }
  if (!request.url) throw new Error('URL が見つかりません。');
  if (!/^https?:\/\//.test(request.url)) request.url = `http://${request.url}`;
  request.method ??= request.body !== null ? 'POST' : 'GET';
  // -d だけで Content-Type を指定しないと、curl はフォームの形式で送る
  if (request.body !== null && !Object.keys(request.headers).some((k) => k.toLowerCase() === 'content-type')) {
    request.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  return request;
}

export function parseAssign(command, vars) {
  const m = command.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/s);
  if (!m) throw new Error('変数の指定として読み取れません。');
  const { words } = shellWords(m[2], vars);
  return { name: m[1], value: words.join(' ') };
}
