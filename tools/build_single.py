"""Собирает dist/phathma.html: index.html + стили + скомпилированный JS в одном файле."""
import re, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
css = open(os.path.join(root, 'css/style.css'), encoding='utf-8').read()
js = open(sys.argv[1], encoding='utf-8').read().replace('</script', '<\\/script')
s = s.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '\n</style>')
s = re.sub(r'<script type="importmap">.*?</script>\n?', '', s, flags=re.S)
s = s.replace('<script type="module" src="js/main.js"></script>', '<script>\n' + js + '\n</script>')
os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
open(os.path.join(root, 'dist/phathma.html'), 'w', encoding='utf-8').write(s)
print('dist/phathma.html', len(s), 'bytes')
