import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import match_db_update as update


class FakeClient:
    blocked_until = 0

    def __init__(self):
        self.history = [{'match_id': 1, 'game_mode': 1}]
        self.calls = []

    def get(self, path, params=None):
        self.calls.append((path, params))
        if path.startswith('/players/'):
            return self.history
        return [{'match_id': int(id), 'players': [{'hero_id': 1}]}
                for id in params['match_ids'].split(',')]


class SnapshotTests(unittest.TestCase):
    def test_incremental_restart_and_deduplicated_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'matches.sqlite'
            client = FakeClient()
            with closing(sqlite3.connect(path)) as db:
                update.setup(db)
                players = [('1', 'One'), ('2', 'Two')]
                update.refresh_histories(db, client, players)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM histories').fetchone()[0], 2)
                update.refresh_metadata(db, client, 20, 8)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM matches').fetchone()[0], 1)
                update.export(db, Path(root) / 'snapshot')
                manifest = json.loads((Path(root) / 'snapshot' / 'manifest.json').read_text())
                self.assertEqual((manifest['savedMatches'], manifest['uniqueHistoryMatches']), (1, 1))
                self.assertEqual(len([c for c in client.calls if c[0] == '/matches/metadata']), 1)
            # Restart from disk. The next history includes one new match; old metadata is reused.
            client.history.append({'match_id': 2, 'game_mode': 1})
            with closing(sqlite3.connect(path)) as db:
                update.setup(db)
                update.refresh_histories(db, client, players, force=True)
                update.refresh_metadata(db, client, 20, 8)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM matches').fetchone()[0], 2)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM histories').fetchone()[0], 4)
                self.assertEqual(client.calls[-1][1]['match_ids'], '2')
                update.export(db, Path(root) / 'snapshot')
                manifest = json.loads((Path(root) / 'snapshot' / 'manifest.json').read_text())
                self.assertEqual(manifest['savedMatches'], 2)
                update.prune_snapshot(Path(root) / 'snapshot')
                files = {p.name for p in (Path(root) / 'snapshot').glob('*.json')}
                self.assertEqual(files, {'manifest.json'} |
                                 {a['file'] for a in manifest['accounts'].values()} |
                                 set(manifest['matches'].values()))
            # Scheduled CI starts with no SQLite file; committed JSON is enough.
            with closing(sqlite3.connect(Path(root) / 'restored.sqlite')) as db:
                update.setup(db)
                self.assertTrue(update.restore_snapshot(db, Path(root) / 'snapshot'))
                self.assertEqual(db.execute('SELECT COUNT(*) FROM matches').fetchone()[0], 2)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM histories').fetchone()[0], 4)

    def test_partial_bulk_response_is_pending_not_a_saved_empty_match(self):
        with tempfile.TemporaryDirectory() as root:
            with closing(sqlite3.connect(Path(root) / 'test.sqlite')) as db:
                update.setup(db)
                db.execute("INSERT INTO accounts(account_id,label) VALUES ('1','One')")
                for id in (1, 2):
                    db.execute('INSERT INTO histories(account_id,match_id,payload) VALUES (?,?,?)',
                               ('1', str(id), json.dumps({'match_id': id})))
                class Partial(FakeClient):
                    def get(self, path, params=None):
                        return [{'match_id': 1}]
                update.refresh_metadata(db, Partial(), 10, 10)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM matches').fetchone()[0], 1)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM pending').fetchone()[0], 1)
                self.assertEqual(db.execute('SELECT match_id FROM pending').fetchone()[0], '2')
                update.export(db, Path(root) / 'snapshot')
            with closing(sqlite3.connect(Path(root) / 'restored.sqlite')) as db:
                update.setup(db)
                self.assertTrue(update.restore_snapshot(db, Path(root) / 'snapshot'))
                self.assertEqual(db.execute('SELECT match_id FROM pending').fetchone()[0], '2')
                client = FakeClient()
                update.refresh_metadata(db, client, 10, 10)
                self.assertEqual(client.calls, [])  # Retry timer survives a new CI runner.


if __name__ == '__main__':
    unittest.main()
