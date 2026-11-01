#!/usr/bin/env python3
"""Update committed JSON snapshots via a temporary SQLite work database.
No third-party packages or external storage: snapshot/ is the durable source.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = 76561197960265728
API = 'https://api.deadlock-api.com/v1'
FIELDS = ['time_stamp_s', 'net_worth', 'player_damage', 'assists', 'creep_kills',
          'player_damage_taken', 'damage_mitigated', 'damage_absorbed', 'teammate_healing',
          'teammate_barriering', 'heal_prevented', 'boss_damage', 'self_healing'] + [
          'gold_source_' + n + '_' + suffix for n in
          ('lane_creeps', 'neutrals', 'treasure', 'breakable') for suffix in ('gold', 'gold_orbs')]
OPTIONS = {'only_filtered_players': 'false', 'include_info': 'true',
           'include_objectives': 'true', 'include_player_kda': 'true',
           'include_player_death_details': 'true',
           'extra_player_columns': ','.join('stats.' + field for field in FIELDS)}
SCHEMA = '''
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY, label TEXT NOT NULL, checked_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS histories (
  account_id TEXT NOT NULL, match_id TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(account_id, match_id), FOREIGN KEY(account_id) REFERENCES accounts(account_id)
);
CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY, payload BLOB NOT NULL, fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending (
  match_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
  next_try INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE INDEX IF NOT EXISTS histories_match ON histories(match_id);
'''


def examples(html):
    block = re.search(r'const DEFAULTS=\[([\s\S]*?)\];', html)
    if not block:
        raise ValueError('Example player list missing')
    found = re.findall(r"\{id:'(\d+)',label:'([^']+)'", block.group(1))
    if not found:
        raise ValueError('No example players found')
    return [(str(int(id) - BASE if int(id) >= BASE else int(id)), label) for id, label in found]


class ApiError(Exception):
    def __init__(self, message, status=0, retry_at=0):
        super().__init__(message)
        self.status, self.retry_at = status, retry_at


class Client:
    def __init__(self, api, spacing=2.5, timeout=30):
        self.api, self.spacing, self.timeout, self.next_start = api.rstrip('/'), spacing, timeout, 0
        self.blocked_until = 0

    def get(self, path, params=None):
        now = time.time()
        wait = max(0, self.next_start - now, self.blocked_until - now)
        if wait:
            # Never silently wait minutes in a scheduled job; keep progress and resume later.
            if wait > 20:
                raise ApiError('API cooldown pending', retry_at=int(now + wait))
            time.sleep(wait)
        self.next_start = time.time() + self.spacing
        url = self.api + path + ('?' + urllib.parse.urlencode(params) if params else '')
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/json',
                                                                         'User-Agent': 'BreadlockSnapshot/0.1 (+https://github.com/amauriciogonzalez/Breadlock)'}),
                                        timeout=self.timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            retry = error.headers.get('Retry-After')
            delay = 0
            if retry:
                try:
                    delay = max(0, float(retry))
                except ValueError:
                    try:
                        from email.utils import parsedate_to_datetime
                        delay = max(0, parsedate_to_datetime(retry).timestamp() - time.time())
                    except (TypeError, ValueError):
                        pass
            if error.code == 429:
                delay = max(delay, 15)
            if delay and (error.code == 429 or error.code >= 500):
                self.blocked_until = max(self.blocked_until, time.time() + delay)
            raise ApiError('HTTP %s at %s' % (error.code, path), error.code,
                           int(self.blocked_until)) from error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ApiError('%s at %s' % (error, path)) from error


def setup(db):
    db.executescript(SCHEMA)
    db.execute('PRAGMA foreign_keys=ON')


def refresh_histories(db, client, players, force=False):
    now = int(time.time())
    for account, label in players:
        db.execute('INSERT INTO accounts(account_id,label) VALUES (?,?) '
                   'ON CONFLICT(account_id) DO UPDATE SET label=excluded.label', (account, label))
        checked = db.execute('SELECT checked_at FROM accounts WHERE account_id=?', (account,)).fetchone()[0]
        if not force and now - checked < 6 * 3600:
            continue
        try:
            data = client.get('/players/%s/match-history' % account, {'only_stored_history': 'true'})
            rows = data if isinstance(data, list) else data.get('data')
            if not isinstance(rows, list):
                raise ApiError('Invalid match history for ' + account)
            for row in rows:
                mid = str(row.get('match_id', ''))
                if mid.isdigit():
                    db.execute('INSERT INTO histories(account_id,match_id,payload) VALUES (?,?,?) '
                               'ON CONFLICT(account_id,match_id) DO UPDATE SET payload=excluded.payload',
                               (account, mid, json.dumps(row, separators=(',', ':'))))
            db.execute('UPDATE accounts SET checked_at=?,last_error=NULL WHERE account_id=?',
                       (int(time.time()), account))
            db.commit()
            print('History %s: %s rows' % (label, len(rows)), flush=True)
        except ApiError as error:
            db.execute('UPDATE accounts SET last_error=? WHERE account_id=?', (str(error), account))
            db.commit()
            print('History %s: %s; retained saved rows' % (label, error), file=sys.stderr, flush=True)
            if client.blocked_until > time.time() + 20:
                break


def fetch_batch(client, ids):
    params = dict(OPTIONS, match_ids=','.join(ids), limit=str(len(ids)))
    try:
        data = client.get('/matches/metadata', params)
        if not isinstance(data, list):
            raise ApiError('Invalid bulk metadata response')
        return data
    except ApiError as error:
        if len(ids) <= 32 or error.status == 429 or not (error.status >= 500 or
                                                        error.status in (413, 414, 431) or error.status == 0):
            raise
        # Retain the server's Retry-After cooldown before requesting either half.
        print('Splitting %s-ID batch after %s' % (len(ids), error), flush=True)
        half = len(ids) // 2
        return fetch_batch(client, ids[:half]) + fetch_batch(client, ids[half:])


def refresh_metadata(db, client, budget, batch_size):
    if budget <= 0:
        return
    now = int(time.time())
    ids = [row[0] for row in db.execute('''
        SELECT DISTINCT h.match_id FROM histories h
        LEFT JOIN matches m ON m.match_id=h.match_id
        LEFT JOIN pending p ON p.match_id=h.match_id
        WHERE m.match_id IS NULL AND COALESCE(p.next_try,0)<=?
        ORDER BY CAST(h.match_id AS INTEGER) DESC LIMIT ?''', (now, budget))]
    for offset in range(0, len(ids), batch_size):
        batch = ids[offset:offset + batch_size]
        try:
            data = fetch_batch(client, batch)
            found = {str(row.get('match_id')): row for row in data if isinstance(row, dict)}
            for mid in batch:
                if mid in found:
                    row = found[mid]
                    db.execute('INSERT OR REPLACE INTO matches(match_id,payload,fetched_at) VALUES (?,?,?)',
                               (mid, gzip.compress(json.dumps(row, separators=(',', ':')).encode()), int(time.time())))
                    db.execute('DELETE FROM pending WHERE match_id=?', (mid,))
                else:
                    db.execute('INSERT INTO pending(match_id,attempts,next_try,last_error) '
                               'VALUES (?,1,?,?) ON CONFLICT(match_id) DO UPDATE SET '
                               'attempts=attempts+1,next_try=excluded.next_try,last_error=excluded.last_error',
                               (mid, now + 86400, 'Missing from successful bulk response'))
            db.commit()
            print('Metadata %s/%s: %s returned' % (min(offset + len(batch), len(ids)), len(ids), len(found)), flush=True)
        except ApiError as error:
            retry_at = max(error.retry_at, int(time.time()) + (60 if error.status == 429 else 300))
            for mid in batch:
                db.execute('INSERT INTO pending(match_id,attempts,next_try,last_error) VALUES (?,1,?,?) '
                           'ON CONFLICT(match_id) DO UPDATE SET attempts=attempts+1,'
                           'next_try=excluded.next_try,last_error=excluded.last_error',
                           (mid, retry_at, str(error)))
            db.commit()
            print('Metadata batch deferred: %s' % error, file=sys.stderr, flush=True)
            if client.blocked_until > time.time() + 20:
                break


def export(db, directory):
    directory.mkdir(parents=True, exist_ok=True)
    accounts = {}
    for account, label, checked, error in db.execute(
            'SELECT account_id,label,checked_at,last_error FROM accounts ORDER BY account_id'):
        rows = [json.loads(row[0]) for row in db.execute(
            'SELECT payload FROM histories WHERE account_id=? ORDER BY CAST(match_id AS INTEGER) DESC', (account,))]
        name = immutable_json(directory, 'history-' + account, rows)
        accounts[account] = {'label': label, 'file': name, 'matches': len(rows),
                             'checkedAt': checked, 'error': error}
    groups = {}
    for index, (mid, payload) in enumerate(db.execute(
            'SELECT match_id,payload FROM matches ORDER BY CAST(match_id AS INTEGER)')):
        # 32 matches/file bounds download size and allows browser-side lazy detail loading.
        group = '%05d' % (index // 32)
        groups.setdefault(group, []).append(json.loads(gzip.decompress(payload)))
    mapping = {}
    for group, rows in groups.items():
        name = immutable_json(directory, 'matches-' + group, rows)
        for row in rows:
            mapping[str(row['match_id'])] = name
    stats = db.execute('SELECT COUNT(*) FROM (SELECT DISTINCT match_id FROM histories)').fetchone()[0]
    pending = {mid: {'attempts': attempts, 'nextTry': next_try, 'error': error}
               for mid, attempts, next_try, error in db.execute(
                   'SELECT match_id,attempts,next_try,last_error FROM pending ORDER BY match_id')}
    manifest = {'version': 1, 'accounts': accounts, 'matches': mapping,
                'uniqueHistoryMatches': stats, 'savedMatches': len(mapping), 'pending': pending}
    previous = directory / 'manifest.json'
    if previous.exists():
        old = json.loads(previous.read_text(encoding='utf-8'))
        if all(old.get(key) == value for key, value in manifest.items()):
            manifest['generatedAt'] = old['generatedAt']
    manifest.setdefault('generatedAt', dt.datetime.now(dt.timezone.utc).isoformat())
    # Manifest published LAST; CI commits all files as one revision.
    atomic_json(previous, manifest)
    print('Export: %s histories, %s/%s unique metadata rows' % (len(accounts), len(mapping), stats), flush=True)


def restore_snapshot(db, directory):
    """Recover canonical rows from a published export if the local DB was lost."""
    source = directory / 'manifest.json'
    if not source.exists():
        return False
    manifest = json.loads(source.read_text(encoding='utf-8'))
    if manifest.get('version') != 1:
        raise ValueError('Unsupported snapshot version')
    # Validate every referenced file before touching the empty database.
    def checked_file(name):
        if Path(name).name != name or not re.search(r'-[a-f0-9]{16}\.json$', name):
            raise ValueError('Invalid snapshot filename')
        content = (directory / name).read_bytes()
        if hashlib.sha256(content).hexdigest()[:16] != name[-21:-5]:
            raise ValueError('Snapshot checksum mismatch: ' + name)
        return json.loads(content)
    histories = {account: checked_file(record['file'])
                 for account, record in manifest['accounts'].items()}
    chunks = {name: checked_file(name) for name in set(manifest['matches'].values())}
    if sum(len(rows) for rows in chunks.values()) != manifest['savedMatches']:
        raise ValueError('Snapshot match count mismatch')
    pending = manifest.get('pending', {})
    with db:
        for account, record in manifest['accounts'].items():
            db.execute('INSERT INTO accounts(account_id,label,checked_at,last_error) VALUES (?,?,?,?)',
                       (account, record['label'], record['checkedAt'], record.get('error')))
            for row in histories[account]:
                db.execute('INSERT INTO histories(account_id,match_id,payload) VALUES (?,?,?)',
                           (account, str(row['match_id']), json.dumps(row, separators=(',', ':'))))
        for rows in chunks.values():
            for row in rows:
                db.execute('INSERT INTO matches(match_id,payload,fetched_at) VALUES (?,?,?)',
                           (str(row['match_id']), gzip.compress(json.dumps(row, separators=(',', ':')).encode()),
                            int(time.time())))
        for mid, state in pending.items():
            if not str(mid).isdigit() or mid in manifest['matches']:
                raise ValueError('Invalid pending match ID: ' + str(mid))
            db.execute('INSERT INTO pending(match_id,attempts,next_try,last_error) VALUES (?,?,?,?)',
                       (mid, state['attempts'], state['nextTry'], state['error']))
    return True


def prune_snapshot(directory):
    """Remove superseded chunks only after manifest publication (for CI commits)."""
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    keep = {record['file'] for record in manifest['accounts'].values()}
    keep.update(manifest['matches'].values())
    for pattern in ('history-*.json', 'matches-*.json'):
        for path in directory.glob(pattern):
            if path.name not in keep:
                path.unlink()


def immutable_json(directory, stem, data):
    content = json.dumps(data, separators=(',', ':')).encode('utf-8')
    name = stem + '-' + hashlib.sha256(content).hexdigest()[:16] + '.json'
    path = directory / name
    if not path.exists():
        temp = path.with_suffix('.tmp')
        temp.write_bytes(content)
        os.replace(temp, path)
    return name


def atomic_json(path, data):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
    os.replace(temp, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=HERE / 'data' / 'matches.sqlite')
    parser.add_argument('--out', type=Path, default=HERE / 'snapshot')
    parser.add_argument('--api', default=API)
    parser.add_argument('--accounts', help='Comma-separated account32 IDs; default: all examples')
    parser.add_argument('--max-metadata', type=int, default=8, help='Maximum new matches per run; 0 disables')
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--force-history', action='store_true')
    parser.add_argument('--offline', action='store_true', help='Re-export without API requests')
    parser.add_argument('--prune', action='store_true', help='Remove superseded JSON chunks after export')
    args = parser.parse_args()
    if args.max_metadata < 0 or not 1 <= args.batch_size <= 64:
        parser.error('Use max-metadata >=0 and batch-size 1..64')
    players = examples((HERE / 'index.html').read_text(encoding='utf-8'))
    if args.accounts:
        wanted = set(args.accounts.split(','))
        players = [(account, label) for account, label in players if account in wanted]
        if wanted != {account for account, _ in players}:
            parser.error('Unknown example account ID')
    args.db.parent.mkdir(parents=True, exist_ok=True)
    new_db = not args.db.exists()
    with sqlite3.connect(args.db) as db:
        setup(db)
        if new_db:
            if restore_snapshot(db, args.out):
                print('Recovered SQLite database from saved snapshot', flush=True)
            elif args.offline:
                raise ValueError('No database or snapshot to publish')
        if not args.offline:
            client = Client(args.api)
            refresh_histories(db, client, players, args.force_history)
            refresh_metadata(db, client, args.max_metadata, args.batch_size)
        export(db, args.out)
        if args.prune:
            prune_snapshot(args.out)


if __name__ == '__main__':
    main()
