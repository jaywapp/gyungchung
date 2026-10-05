import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// Adapter for replaying the existing synthetic PGlite harness on real Postgres.
// No connection string, remote host, or application credentials are accepted.
assert.ok(process.env.POTM_PG_MODULE, "POTM_PG_MODULE must point to an isolated pg package");
const { default: pg } = await import(pathToFileURL(process.env.POTM_PG_MODULE).href);
pg.types.setTypeParser(20, Number);
export class PGlite {
  constructor() {
    this.client = new pg.Client({ host:"127.0.0.1", port:55437, user:"postgres", database:"potm_batch_synthetic" });
    this.ready = this.client.connect().then(async () => {
      const { rows } = await this.client.query("select current_database() as db, host(inet_server_addr()) as host");
      assert.equal(rows[0].db, "potm_batch_synthetic");
      assert.equal(rows[0].host, "127.0.0.1");
    });
  }
  async exec(sql) {
    await this.ready;
    const result = await this.client.query(sql);
    return Array.isArray(result) ? result : [result];
  }
  async query(sql) { await this.ready; return this.client.query(sql); }
  async close() { await this.ready; await this.client.end(); }
}
