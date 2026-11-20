/**
 * Безопасный запуск PowerShell.
 *
 * - Скрипт передаётся через -EncodedCommand (base64 UTF-16LE), поэтому кавычки,
 *   апострофы и $ в именах программ не ломают команду.
 * - Аргументы передаются отдельно, как JSON в base64, и доступны в скрипте
 *   как переменная $A. Внутрь текста скрипта пользовательские строки не попадают.
 * - Вывод скрипта в UTF-8.
 */
const { spawn } = require('child_process');

const PS_EXE = 'powershell.exe';

function b64utf16(text) {
  return Buffer.from(text, 'utf16le').toString('base64');
}

function buildScript(script, args = {}) {
  const argsB64 = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
  return [
    '$ErrorActionPreference = "Stop"',
    '$ProgressPreference = "SilentlyContinue"', // без служебных сообщений «Preparing modules…» в выводе
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$A = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${argsB64}')) | ConvertFrom-Json`,
    script,
  ].join('\n');
}

/**
 * Выполнить скрипт. Возвращает { ok, code, stdout, stderr }. Никогда не бросает.
 */
function run(script, args = {}, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', done = false;
    let child;
    try {
      child = spawn(PS_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', b64utf16(buildScript(script, args))], { windowsHide: true });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(e) });
      return;
    }
    const timer = setTimeout(() => {
      if (!done) { try { child.kill(); } catch {} finish(-2, 'timeout'); }
    }, timeout);
    function finish(code, extraErr) {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: (stderr + (extraErr || '')).trim() });
    }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish(-1, String(e)));
    child.on('close', (code) => finish(code == null ? -1 : code));
  });
}

/** Выполнить скрипт, который печатает JSON. Возвращает разобранный объект или fallback. */
async function runJson(script, args = {}, fallback = null, opts) {
  const r = await run(script, args, opts);
  if (!r.stdout) return fallback;
  try { return JSON.parse(r.stdout); } catch { return fallback; }
}

/**
 * Выполнить скрипт с правами администратора (появится окно UAC).
 * Возвращает { ok, code, cancelled }.
 * Окружение в повышенный процесс не передаётся, поэтому аргументы
 * зашиваются в сам закодированный скрипт (base64, без кавычек).
 */
async function runElevated(script, args = {}, opts) {
  const inner = b64utf16(buildScript(script, args));
  const outer = [
    'try {',
    `  $p = Start-Process -FilePath '${PS_EXE}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
      `-ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${inner}'`,
    '  exit $p.ExitCode',
    '} catch {',
    '  exit 1223', // ERROR_CANCELLED: пользователь нажал «Нет» в окне UAC
    '}',
  ].join('\n');
  const r = await run(outer, {}, opts);
  return { ok: r.code === 0, code: r.code, cancelled: r.code === 1223 };
}

module.exports = { run, runJson, runElevated, buildScript };
