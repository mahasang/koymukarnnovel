import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"

test("Node >= 22.13", () => {
  const [major, minor] = process.versions.node.split(".").map(Number)
  assert.ok(major > 22 || (major === 22 && minor >= 13), `Node ${process.versions.node} is too old`)
})

test("node:sqlite roundtrip", () => {
  const db = new DatabaseSync(":memory:")
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
  const res = db.prepare("INSERT INTO t (name) VALUES (?)").run("สวัสดี")
  assert.equal(Number(res.changes), 1)
  assert.equal(db.prepare("SELECT name FROM t WHERE id = ?").get(1)?.name, "สวัสดี")
  assert.deepEqual(db.prepare("SELECT id, name FROM t").all().map((r) => r.name), ["สวัสดี"])
  db.close()
})
