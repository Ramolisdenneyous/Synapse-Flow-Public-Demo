export async function drainSequential({
  sessionId,
  isActive,
  queue,
  processEvent,
  onQueueChange = () => {},
  wait = () => Promise.resolve(),
  isPaused = () => false,
  waitForResume = () => Promise.resolve(),
  maxEvents = 200,
}) {
  let processed = 0;

  while (isActive(sessionId) && queue.length && processed < maxEvents) {
    if (isPaused(sessionId)) await waitForResume(sessionId);
    if (!isActive(sessionId)) {
      return { processed, reason: 'superseded' };
    }
    const event = queue.shift();
    onQueueChange(queue.length);
    const next = await processEvent(event, sessionId);
    if (!isActive(sessionId)) {
      return { processed, reason: 'superseded' };
    }
    queue.push(...next);
    processed += 1;
    onQueueChange(queue.length);
    if (queue.length) await wait();
  }

  return {
    processed,
    reason: !isActive(sessionId)
      ? 'superseded'
      : processed >= maxEvents
        ? 'limit'
        : 'complete',
  };
}

export async function drainParallel({
  sessionId,
  isActive,
  queue,
  processEvent,
  onQueueChange = () => {},
  isPaused = () => false,
  waitForResume = () => Promise.resolve(),
  maxEvents = 200,
}) {
  let processed = 0;

  while (isActive(sessionId) && queue.length && processed < maxEvents) {
    if (isPaused(sessionId)) await waitForResume(sessionId);
    if (!isActive(sessionId)) {
      return { processed, reason: 'superseded' };
    }
    const remaining = maxEvents - processed;
    const wave = queue.splice(0, remaining);
    onQueueChange(queue.length);
    const results = await Promise.all(
      wave.map((event) => processEvent(event, sessionId)),
    );
    if (!isActive(sessionId)) {
      return { processed, reason: 'superseded' };
    }
    queue.push(...results.flat());
    processed += wave.length;
    onQueueChange(queue.length);
  }

  return {
    processed,
    reason: !isActive(sessionId)
      ? 'superseded'
      : processed >= maxEvents
        ? 'limit'
        : 'complete',
  };
}
