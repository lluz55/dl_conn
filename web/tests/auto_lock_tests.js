/* auto_lock_tests.js — Tests for the 1/3/5/10/15/30/60 minute options */

import { SessionManager } from '../js/session_manager.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

const _store = {};
globalThis.localStorage = {
  getItem: (k) => _store[k] || null,
  setItem: (k, v) => { _store[k] = v; },
  removeItem: (k) => { delete _store[k]; },
};
globalThis.document = { addEventListener: () => {}, hidden: false };

console.log("\n=== Auto-Lock Options Tests ===");

// Test: 1 minute
{
  localStorage.removeItem("dl_conn_auto_lock_timeout");
  const sm = new SessionManager();
  sm.setInactivityTimeout(1);
  assert(sm.inactivityTimeoutMinutes === 1, "1 minute is set");
  assert(localStorage.getItem("dl_conn_auto_lock_timeout") === "1", "1 minute persisted in localStorage");
}

// Test: 3 minutes
{
  localStorage.removeItem("dl_conn_auto_lock_timeout");
  const sm = new SessionManager();
  sm.setInactivityTimeout(3);
  assert(sm.inactivityTimeoutMinutes === 3, "3 minutes is set");
  assert(localStorage.getItem("dl_conn_auto_lock_timeout") === "3", "3 minutes persisted in localStorage");
}

// Test: 0 (disabled)
{
  localStorage.removeItem("dl_conn_auto_lock_timeout");
  const sm = new SessionManager();
  sm.setInactivityTimeout(0);
  assert(sm.inactivityTimeoutMinutes === 0, "0 means disabled");
  assert(localStorage.getItem("dl_conn_auto_lock_timeout") === "0", "0 persisted");
}

// Test: 60 (1 hour)
{
  localStorage.removeItem("dl_conn_auto_lock_timeout");
  const sm = new SessionManager();
  sm.setInactivityTimeout(60);
  assert(sm.inactivityTimeoutMinutes === 60, "60 minutes is set");
}

// Test: Reload persists 1 minute
{
  localStorage.setItem("dl_conn_auto_lock_timeout", "1");
  const sm = new SessionManager();
  assert(sm.inactivityTimeoutMinutes === 1, "1 minute restored on reload");
}

// Test: Reload persists 3 minutes
{
  localStorage.setItem("dl_conn_auto_lock_timeout", "3");
  const sm = new SessionManager();
  assert(sm.inactivityTimeoutMinutes === 3, "3 minutes restored on reload");
}

// Test: Default (no localStorage entry) is 15 min
{
  localStorage.removeItem("dl_conn_auto_lock_timeout");
  const sm = new SessionManager();
  assert(sm.inactivityTimeoutMinutes === 15, "default is 15 minutes");
}

// Test: switch from 1 to 3 to 5
{
  localStorage.removeItem("dl_conn_auto_lock_timeout");
  const sm = new SessionManager();
  sm.setInactivityTimeout(1);
  assert(sm.inactivityTimeoutMinutes === 1, "set 1");
  sm.setInactivityTimeout(3);
  assert(sm.inactivityTimeoutMinutes === 3, "switched to 3");
  sm.setInactivityTimeout(5);
  assert(sm.inactivityTimeoutMinutes === 5, "switched to 5");
}

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
