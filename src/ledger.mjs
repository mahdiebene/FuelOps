import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Ledger {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, run TEXT NOT NULL, created INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, run TEXT NOT NULL, plan TEXT NOT NULL, proposal INTEGER NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, allocation TEXT, error TEXT, created INTEGER NOT NULL, UNIQUE(run,plan,proposal));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);`);
    if (!this.get('run')) this.set('run', randomUUID());
    this.run = this.get('run');
  }
  get(key) { const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  set(key, value) { this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  event(kind, detail) {
    const entry = { time: Date.now(), kind, detail };
    this.db.prepare('INSERT INTO events(time,kind,detail) VALUES (?,?,?)').run(entry.time, kind, JSON.stringify(detail));
    this.db.exec('DELETE FROM events WHERE id < (SELECT MAX(id)-500 FROM events)');
    console.log(JSON.stringify({ ...entry, run: this.run }));
  }
  savePlan(plan) {
    this.db.prepare('INSERT INTO plans VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET created=excluded.created').run(plan.id, this.run, Date.now(), JSON.stringify(plan));
    this.db.prepare('DELETE FROM plans WHERE created < ? AND id NOT IN (SELECT plan FROM intents)').run(Date.now() - 3600000);
  }
  plan(id) { const row = this.db.prepare('SELECT * FROM plans WHERE id=?').get(id); return row ? { ...JSON.parse(row.body), created: row.created } : null; }
  intent(plan, proposal) { return this.db.prepare('SELECT * FROM intents WHERE run=? AND plan=? AND proposal=?').get(this.run, plan, proposal); }
  prepare(plan, proposal, payload) {
    const existing = this.intent(plan, proposal); if (existing) return existing;
    const id = randomUUID();
    const body = { ...payload, idempotency_key: `${this.run}:${id}` };
    this.db.prepare('INSERT INTO intents(id,run,plan,proposal,body,status,created) VALUES (?,?,?,?,?,?,?)').run(id, this.run, plan, proposal, JSON.stringify(body), 'PREPARED', Date.now());
    return this.intent(plan, proposal);
  }
  update(id, status, allocation = null, error = null) { this.db.prepare('UPDATE intents SET status=?,allocation=COALESCE(?,allocation),error=? WHERE id=?').run(status, allocation ? JSON.stringify(allocation) : null, error, id); }
  pending() { return this.db.prepare("SELECT * FROM intents WHERE run=? AND status IN ('PREPARED','SENDING','UNKNOWN')").all(this.run); }
  confirmed() { return this.db.prepare("SELECT * FROM intents WHERE run=? AND status='CONFIRMED'").all(this.run); }
  history() { return this.db.prepare('SELECT * FROM intents ORDER BY created DESC LIMIT 100').all().map(x => ({ ...x, body: JSON.parse(x.body), allocation: x.allocation ? JSON.parse(x.allocation) : null })); }
  events() { return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 60').all().map(x => ({ ...x, detail: JSON.parse(x.detail) })); }
  newRun() { this.run = randomUUID(); this.set('run', this.run); this.set('lastInstance', null); this.event('run.started', {}); }
  close() { this.db.close(); }
}