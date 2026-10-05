import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_INITIAL_STRUCTURE_DELAY_MS,
  DEFAULT_INITIAL_CONTENT_DELAY_MS,
  MAX_INITIAL_LOADING_DELAY_MS,
  advanceInitialLoadingPresentation,
  normalizeInitialLoadingDelays,
  readInitialLoadingPresentation,
  scheduleInitialLoadingPresentation,
} from "../src/components/loading/initial-loading-presentation.ts";

const initial = { scopeKey: "organization-a:list", pending: true, hasData: false };
const view = readInitialLoadingPresentation;
const advance = advanceInitialLoadingPresentation;

function clock() {
  let now = 0;
  let id = 0;
  const tasks = new Map();
  const scheduler = {
    now: () => now,
    setTimeout(callback, delay) {
      const handle = ++id;
      tasks.set(handle, { callback, at: now + delay });
      return handle;
    },
    clearTimeout: handle => tasks.delete(handle),
  };
  return {
    scheduler,
    tasks,
    at(time) {
      now = time;
      for (const [handle, task] of [...tasks]) {
        if (task.at <= now) {
          tasks.delete(handle);
          task.callback();
        }
      }
    },
    fireEarly(time) {
      now = time;
      const [handle, task] = [...tasks][0];
      assert.ok(time < task.at, "fake callback intentionally fires before its scheduled time");
      tasks.delete(handle);
      task.callback();
    },
  };
}

test("initial structure reveals at 80ms and fast volatile data waits only until the total 260ms deadline", () => {
  let state = advance(null, initial, 1_000);
  assert.deepEqual(view(state), { structurePending: true, contentPending: true });
  assert.equal(state.startedAt, 1_000);
  state = advance(state, { ...initial, pending: false, hasData: true }, 1_025);
  assert.deepEqual(view(state), { structurePending: true, contentPending: true });
  state = advance(state, state.input, 1_080);
  assert.deepEqual(view(state), { structurePending: false, contentPending: true });
  state = advance(state, state.input, 1_259);
  assert.equal(view(state).contentPending, true);
  state = advance(state, state.input, 1_260);
  assert.deepEqual(view(state), { structurePending: false, contentPending: false });
  assert.equal(state.contentDeadline, 1_260, "response never starts another 260ms window");
});

test("a slow response reveals immediately after real readiness without an added delay", () => {
  let state = advance(null, initial, 0);
  state = advance(state, initial, 260);
  assert.deepEqual(view(state), { structurePending: false, contentPending: true });
  state = advance(state, { ...initial, pending: false, hasData: true }, 4_000);
  assert.deepEqual(view(state), { structurePending: false, contentPending: false });
  const time = clock();
  scheduleInitialLoadingPresentation(state, time.scheduler, () => assert.fail("settled presentation has no timer"));
  assert.equal(time.tasks.size, 0);
});

test("valid first-render cache including an empty snapshot bypasses both artificial stages", () => {
  for (const pending of [true, false]) {
    const state = advance(null, { ...initial, pending, hasData: true }, 0);
    assert.deepEqual(view(state), { structurePending: false, contentPending: false });
    assert.equal(state.startedAt, null);
    assert.equal(state.phase, "complete");
  }
});

test("refresh and changing response identity do not remask a completed region", () => {
  let state = advance(null, initial, 0);
  state = advance(state, { ...initial, pending: false, hasData: true }, 300);
  for (const pending of [true, false, true, false]) {
    state = advance(state, { ...initial, pending, hasData: true }, 600);
    assert.deepEqual(view(state), { structurePending: false, contentPending: false });
    assert.equal(state.startedAt, 0);
  }
  state = advance(state, initial, 800);
  assert.deepEqual(view(state), { structurePending: false, contentPending: true }, "uncached real loading does not restart artificial stages");
  assert.equal(state.contentDeadline, 260);
});

test("a deferred request may start after an initial idle render without an empty result marking completion", () => {
  let state = advance(null, { ...initial, pending: false }, 0);
  assert.equal(state.phase, "idle");
  assert.deepEqual(view(state), { structurePending: false, contentPending: false });
  state = advance(state, initial, 20);
  assert.equal(state.startedAt, 20);
  assert.equal(state.structureDeadline, 100);
  assert.equal(state.contentDeadline, 280);
  assert.deepEqual(view(state), { structurePending: true, contentPending: true });
});

test("successful empty result follows the same first-load deadline", () => {
  let state = advance(null, initial, 0);
  state = advance(state, { ...initial, pending: false, hasData: true }, 20);
  assert.equal(view(state).contentPending, true);
  state = advance(state, state.input, 260);
  assert.equal(view(state).contentPending, false);
});

test("failure, auth loss and cancellation cancel presentation immediately without staging a retry", () => {
  for (const terminal of [{ failed: true }, { cancelled: true }]) {
    let state = advance(null, initial, 0);
    state = advance(state, { ...initial, ...terminal }, 10);
    assert.deepEqual(view(state), { structurePending: false, contentPending: false });
    const time = clock();
    scheduleInitialLoadingPresentation(state, time.scheduler, () => assert.fail("terminal state must not schedule"));
    assert.equal(time.tasks.size, 0);
    state = advance(state, initial, 20);
    assert.deepEqual(view(state), { structurePending: false, contentPending: true });
    state = advance(state, { ...initial, pending: false, hasData: true }, 25);
    assert.equal(view(state).contentPending, false);
  }
});

test("scope supersession resets only the new uncached request and old callbacks are inert", () => {
  const time = clock();
  const old = advance(null, initial, 0);
  let fired = false;
  const cleanup = scheduleInitialLoadingPresentation(old, time.scheduler, () => { fired = true; });
  const queued = [...time.tasks.values()][0].callback;
  const replacement = advance(old, { ...initial, scopeKey: "organization-b:list" }, 40);
  cleanup();
  queued();
  assert.equal(fired, false, "cleanup invalidates even an already-queued old callback");
  assert.equal(replacement.startedAt, 40);
  assert.equal(replacement.structureDeadline, 120);
  assert.equal(replacement.contentDeadline, 300);
  assert.deepEqual(view(replacement), { structurePending: true, contentPending: true });
  const cachedScope = advance(replacement, { ...initial, scopeKey: "organization-c:list", hasData: true }, 50);
  assert.deepEqual(view(cachedScope), { structurePending: false, contentPending: false });
});

test("reduced motion removes artificial delay but never claims pending data is ready", () => {
  let state = advance(null, { ...initial, reducedMotion: true }, 0);
  assert.deepEqual(view(state), { structurePending: false, contentPending: true });
  state = advance(state, { ...initial, reducedMotion: true, pending: false, hasData: true }, 1);
  assert.deepEqual(view(state), { structurePending: false, contentPending: false });
  const time = clock();
  scheduleInitialLoadingPresentation(state, time.scheduler, () => assert.fail("reduced motion schedules no delay"));
  assert.equal(time.tasks.size, 0);
});

test("enabling reduced motion during a stage releases it immediately and disabling it cannot replay", () => {
  let state = advance(null, initial, 0);
  state = advance(state, { ...initial, pending: false, hasData: true }, 10);
  state = advance(state, { ...state.input, reducedMotion: true }, 20);
  assert.deepEqual(view(state), { structurePending: false, contentPending: false });
  state = advance(state, { ...state.input, reducedMotion: false }, 21);
  assert.deepEqual(view(state), { structurePending: false, contentPending: false });
});

test("central delays are finite, bounded, configurable and ordered", () => {
  assert.equal(DEFAULT_INITIAL_STRUCTURE_DELAY_MS, 80);
  assert.equal(DEFAULT_INITIAL_CONTENT_DELAY_MS, 260);
  assert.deepEqual(normalizeInitialLoadingDelays(), { structureDelayMs: 80, contentDelayMs: 260 });
  assert.deepEqual(normalizeInitialLoadingDelays({ structureDelayMs: NaN, contentDelayMs: Infinity }), { structureDelayMs: 80, contentDelayMs: 260 });
  assert.deepEqual(normalizeInitialLoadingDelays({ structureDelayMs: 1_000, contentDelayMs: 2_000 }), { structureDelayMs: MAX_INITIAL_LOADING_DELAY_MS, contentDelayMs: MAX_INITIAL_LOADING_DELAY_MS });
  assert.deepEqual(normalizeInitialLoadingDelays({ structureDelayMs: 120, contentDelayMs: 50 }), { structureDelayMs: 50, contentDelayMs: 50 });
  assert.deepEqual(normalizeInitialLoadingDelays({ structureDelayMs: -1, contentDelayMs: -1 }), { structureDelayMs: 0, contentDelayMs: 0 });
  const state = advance(null, { ...initial, structureDelayMs: 40, contentDelayMs: 100 }, 20);
  assert.equal(state.structureDeadline, 60);
  assert.equal(state.contentDeadline, 120);
  const noDelay = advance(null, { ...initial, contentDelayMs: 0 }, 0);
  assert.equal(noDelay.phase, "complete");
  assert.equal(view(noDelay).structurePending, false);
});

test("deadline scheduling uses remaining time and setup-cleanup-setup keeps StrictMode timing", () => {
  const time = clock();
  const state = advance(null, initial, 0);
  time.at(20);
  let fired = 0;
  const cleanup = scheduleInitialLoadingPresentation(state, time.scheduler, () => { fired += 1; });
  assert.equal([...time.tasks.values()][0].at, 80);
  cleanup();
  assert.equal(time.tasks.size, 0);
  const secondCleanup = scheduleInitialLoadingPresentation(state, time.scheduler, () => { fired += 1; });
  assert.equal([...time.tasks.values()][0].at, 80, "effect replay does not restart the initial clock");
  time.at(79);
  assert.equal(fired, 0);
  time.at(80);
  assert.equal(fired, 1);
  secondCleanup();
  assert.equal(time.tasks.size, 0);
});

test("two phases schedule independently without stretching the response deadline", () => {
  const time = clock();
  let state = advance(null, initial, 0);
  let cleanups = [];
  function schedule() {
    cleanups.push(scheduleInitialLoadingPresentation(state, time.scheduler, () => {
      state = advance(state, state.input, time.scheduler.now());
      schedule();
    }));
  }
  schedule();
  time.at(80);
  assert.equal(state.phase, "content");
  assert.equal([...time.tasks.values()][0].at, 260);
  time.at(260);
  assert.equal(state.phase, "complete");
  assert.equal(time.tasks.size, 0);
  cleanups.forEach(cleanup => cleanup());
});

test("unmount cleanup releases active timers and prevents late state updates", () => {
  const time = clock();
  const state = advance(null, initial, 0);
  let fired = false;
  const cleanup = scheduleInitialLoadingPresentation(state, time.scheduler, () => { fired = true; });
  const queued = [...time.tasks.values()][0].callback;
  cleanup();
  cleanup();
  queued();
  time.at(10_000);
  assert.equal(time.tasks.size, 0);
  assert.equal(fired, false);
});

test("unchanged input/time returns stable identity; hook guards stale timer updates and media cleanup", async () => {
  const state = advance(null, initial, 0);
  assert.equal(advance(state, { ...initial }, 10), state);
  const hook = await readFile(new URL("../src/components/loading/useInitialLoadingPresentation.ts", import.meta.url), "utf8");
  assert.match(hook, /current === presentation/);
  assert.match(hook, /useEffect\(\(\) => scheduleInitialLoadingPresentation/);
  assert.match(hook, /return \(\) => media\.removeEventListener\("change", onChange\)/);
  assert.match(hook, /useSyncExternalStore\(subscribeReducedMotion, getReducedMotionSnapshot/);
  assert.doesNotMatch(hook, /fetch\(|\.then\(|await /);
});


test("fractional early callbacks rearm both deadlines and eventually release fast data", () => {
  const time = clock();
  time.at(0.25);
  let state = advance(null, initial, time.scheduler.now());
  state = advance(state, { ...initial, pending: false, hasData: true }, 20.25);
  let releases = 0;
  let cleanup = () => {};
  function schedule() {
    cleanup = scheduleInitialLoadingPresentation(state, time.scheduler, () => {
      releases += 1;
      state = advance(state, state.input, time.scheduler.now());
      schedule();
    });
  }
  time.at(20.25);
  schedule();
  assert.equal([...time.tasks.values()][0].at, 80.25);
  time.fireEarly(80.1);
  assert.equal(releases, 0);
  assert.equal(time.tasks.size, 1, "early structural callback must leave a replacement timer");
  assert.equal([...time.tasks.values()][0].at, 81.1);
  time.at(81.1);
  assert.equal(releases, 1);
  assert.deepEqual(view(state), { structurePending: false, contentPending: true });
  assert.equal([...time.tasks.values()][0].at, 261.1, "fractional remaining content delay is rounded up");
  time.fireEarly(260.1);
  assert.equal(releases, 1);
  assert.equal(time.tasks.size, 1, "early content callback cannot strand the ready data gate");
  assert.equal([...time.tasks.values()][0].at, 261.1);
  time.at(261.1);
  assert.equal(releases, 2);
  assert.deepEqual(view(state), { structurePending: false, contentPending: false });
  assert.equal(time.tasks.size, 0);
  time.at(10_000);
  assert.equal(releases, 2);
  cleanup();
});

test("cleanup cancels the latest rearmed timer and makes queued callbacks from an old scope inert", () => {
  for (const phase of ["structure", "content"]) {
    const time = clock();
    time.at(0.25);
    let state = advance(null, initial, time.scheduler.now());
    if (phase === "content") {
      time.at(80.25);
      state = advance(state, { ...initial, pending: false, hasData: true }, time.scheduler.now());
    }
    const deadline = phase === "structure" ? state.structureDeadline : state.contentDeadline;
    let oldReleases = 0;
    const cleanup = scheduleInitialLoadingPresentation(state, time.scheduler, () => { oldReleases += 1; });
    time.fireEarly(deadline - 0.1);
    const [latestHandle, queued] = [...time.tasks][0];
    cleanup();
    assert.equal(time.tasks.has(latestHandle), false, "cleanup clears replacement handle, not the already-fired original");
    assert.equal(time.tasks.size, 0);
    const replacement = advance(state, { ...initial, scopeKey: "replacement" }, time.scheduler.now());
    let replacementReleases = 0;
    const cleanupReplacement = scheduleInitialLoadingPresentation(replacement, time.scheduler, () => { replacementReleases += 1; });
    queued.callback();
    assert.equal(oldReleases, 0, "stale queued callback cannot release either scope");
    assert.equal(replacementReleases, 0);
    time.at(replacement.structureDeadline);
    assert.equal(oldReleases, 0);
    assert.equal(replacementReleases, 1);
    cleanupReplacement();
    assert.equal(time.tasks.size, 0);
  }
});


test("shared stagePending represents only the artificial clock, independent of real data readiness", async () => {
  const stagePending = state => state.phase === "structure" || state.phase === "content";
  let active = advance(null, initial, 0);
  assert.equal(stagePending(active), true);
  active = advance(active, { ...initial, pending: false, hasData: true }, 20);
  assert.equal(stagePending(active), true, "fast-ready data still shares the active first-load clock");
  active = advance(active, active.input, 80);
  assert.equal(stagePending(active), true, "content stage remains after static text reveals");
  active = advance(active, active.input, 260);
  assert.equal(stagePending(active), false);
  assert.equal(view(active).contentPending, false);

  const slow = advance(advance(null, initial, 0), initial, 260);
  assert.equal(stagePending(slow), false, "slow real requests cannot extend the shared artificial clock");
  assert.equal(view(slow).contentPending, true);
  for (const options of [{ hasData: true }, { failed: true }, { cancelled: true }, { reducedMotion: true }]) {
    const bypassed = advance(null, { ...initial, ...options }, 0);
    assert.equal(stagePending(bypassed), false);
  }
  const hook = await readFile(new URL("../src/components/loading/useInitialLoadingPresentation.ts", import.meta.url), "utf8");
  assert.match(hook, /\.\.\.readInitialLoadingPresentation\(presentation\)/);
  assert.match(hook, /stagePending: presentation\.phase === "structure" \|\| presentation\.phase === "content"/);
});
