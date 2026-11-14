from pathlib import Path
p = Path('src/pages/MoviePlayer.js')
lines = p.read_text(encoding='utf-8').splitlines(True)
line_num = 1697
if line_num - 1 >= len(lines):
    raise SystemExit(f'File has only {len(lines)} lines')
lines[line_num - 1] = '        {/* ══ CONTROLS BAR ══ */}\n'
p.write_text(''.join(lines), encoding='utf-8')
print(f'patched line {line_num}')
