"""SQLite parser, not a semicolon splitter. Input/output are local synthetic SQL."""
import json, sqlite3, sys
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

def split(sql):
    chunks, pending = [], ''
    for line in sql.splitlines(keepends=True):
        pending += line
        if sqlite3.complete_statement(pending):
            chunks.append(pending)
            pending = ''
    if pending or ''.join(chunks) != sql:
        raise ValueError('Incomplete SQL')
    return chunks

request = json.load(sys.stdin)
if set(request) == {'fixture', 'candidate'}:
    fixture, candidate = split(request['fixture']), split(request['candidate'])
    db = sqlite3.connect(':memory:')
    for stmt in fixture:
        db.execute(stmt)  # rejects multiple statements per chunk
    before = db.execute('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY rowid').fetchall()
    for stmt in candidate:
        db.execute(stmt)
    after = db.execute('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY rowid').fetchall()
    print(json.dumps({'fixture': fixture, 'candidate': candidate, 'delta': [r for r in after if r not in before]}))
    db.close()
elif set(request) == {'sql'}:
    print(json.dumps(split(request['sql'])))
else:
    raise ValueError('Unknown extraction mode')
