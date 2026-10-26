import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionCookie, startServer } from './helpers.js';

// A signed-in API client for one person (via dev login).
async function clientFor(base, userId) {
  const login = await fetch(`${base}/auth/dev-login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }),
  });
  const cookie = sessionCookie(login);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { cookie, ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { id: userId, call };
}

// Jack and Jaime (seeded), friends with each other, sharing a group called Home.
async function setup(t) {
  const { base, db } = await startServer(t, { devLogin: true });
  const { devUsers } = await fetch(`${base}/auth/config`).then((r) => r.json());
  const idOf = (name) => devUsers.find((u) => u.name === name).id;
  const jack = await clientFor(base, idOf('Jack'));
  const jaime = await clientFor(base, idOf('Jaime'));

  await jack.call('POST', '/friends', { email: 'jaime@example.com' });
  const { body: home } = await jack.call('POST', '/groups', { name: 'Home', memberIds: [jaime.id] });

  // Adds a third person (Sam) as Jack's friend, and returns a client for them.
  const addSam = async () => {
    const { body: sam } = await jack.call('POST', '/friends', { email: 'sam@example.com', name: 'Sam' });
    return clientFor(base, sam.id);
  };
  return { base, db, jack, jaime, home, addSam };
}

const expense = (overrides) => ({ description: 'Groceries', amount: '50.00', split: 'equal', spentOn: '2026-10-26', ...overrides });

test('API endpoints require sign-in', async (t) => {
  const { base } = await startServer(t);
  for (const [method, path] of [['GET', '/groups'], ['GET', '/friends'], ['GET', '/activity'], ['POST', '/groups/1/expenses']]) {
    assert.equal((await fetch(`${base}/api${path}`, { method })).status, 401, `${method} ${path}`);
  }
});

test('unknown API paths get a JSON 404', async (t) => {
  const { jack } = await setup(t);
  const res = await jack.call('GET', '/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
});

// ---------- Account ----------

test('account: see your details and change your name', async (t) => {
  const { jaime } = await setup(t);
  const me = await jaime.call('GET', '/me');
  assert.deepEqual(me.body.user.emails, ['jaime@example.com', 'jaime.alt@example.com']);

  const renamed = await jaime.call('PATCH', '/me', { name: '  Jaime M  ' });
  assert.equal(renamed.body.user.name, 'Jaime M');
  assert.equal((await jaime.call('PATCH', '/me', { name: ' ' })).body.field, 'name');
});

// ---------- Friends ----------

test('friends: adding is mutual, and lookup previews who an email belongs to', async (t) => {
  const { jack, jaime } = await setup(t);
  assert.deepEqual((await jaime.call('GET', '/friends')).body.map((f) => f.name), ['Jack']);

  const known = await jack.call('GET', '/friends/lookup?email=JAIME.ALT@example.com');
  assert.deepEqual(known.body, { email: 'jaime.alt@example.com', user: { id: jaime.id, name: 'Jaime' }, isYou: false, isFriend: true });

  const unknown = await jack.call('GET', '/friends/lookup?email=new@example.com');
  assert.equal(unknown.body.user, null);
  assert.equal((await jack.call('GET', '/friends/lookup?email=nope')).body.field, 'email');
});

test('friends: inviting a new email needs a name; your own email is refused', async (t) => {
  const { jack } = await setup(t);
  assert.equal((await jack.call('POST', '/friends', { email: 'new@example.com' })).body.field, 'name');
  assert.equal((await jack.call('POST', '/friends', { email: 'jack@example.com' })).body.field, 'email');
  assert.equal((await jack.call('POST', '/friends', { email: 'not-an-email', name: 'X' })).body.field, 'email');

  const added = await jack.call('POST', '/friends', { email: 'New@Example.com', name: 'Newbie' });
  assert.equal(added.status, 201);
  assert.equal(added.body.email, 'new@example.com');
  assert.equal(added.body.balanceCents, 0);

  // Adding again is harmless.
  assert.equal((await jack.call('POST', '/friends', { email: 'new@example.com' })).status, 201);
  assert.equal((await jack.call('GET', '/friends')).body.length, 2);
});

test('friends: balances add up across groups', async (t) => {
  const { jack, jaime, home, addSam } = await setup(t);
  const sam = await addSam();
  const { body: trip } = await jack.call('POST', '/groups', { name: 'Trip', memberIds: [jaime.id, sam.id] });

  await jack.call('POST', `/groups/${home.id}/expenses`, expense({ amount: '50', paidBy: jack.id })); // Jaime owes Jack 25
  await jaime.call('POST', `/groups/${trip.id}/expenses`, expense({ amount: '30', paidBy: jaime.id })); // Jack owes Jaime 10, Sam owes Jaime 10

  const friends = Object.fromEntries((await jack.call('GET', '/friends')).body.map((f) => [f.name, f.balanceCents]));
  assert.deepEqual(friends, { Jaime: 1500, Sam: 0 });
  const jaimesFriends = Object.fromEntries((await jaime.call('GET', '/friends')).body.map((f) => [f.name, f.balanceCents]));
  assert.deepEqual(jaimesFriends, { Jack: -1500 });
});

// ---------- Groups ----------

test('groups: create with friends only, list with your balance', async (t) => {
  const { jack, jaime, home, addSam } = await setup(t);
  assert.deepEqual(home.members.map((m) => m.name), ['Jack', 'Jaime']);

  // Jaime isn't friends with Sam, so she can't add Sam.
  const sam = await addSam();
  assert.equal((await jaime.call('POST', '/groups', { name: 'X', memberIds: [sam.id] })).body.field, 'memberIds');
  assert.equal((await jack.call('POST', '/groups', { name: ' ', memberIds: [] })).body.field, 'name');

  await jack.call('POST', `/groups/${home.id}/expenses`, expense({ paidBy: jack.id }));
  const groups = (await jaime.call('GET', '/groups')).body;
  assert.deepEqual(groups.map((g) => [g.name, g.balanceCents]), [['Home', -2500]]);
  assert.deepEqual((await sam.call('GET', '/groups')).body, []);
});

test('groups: non-members cannot see or touch a group', async (t) => {
  const { jack, home, addSam } = await setup(t);
  const sam = await addSam();
  const { body: created } = await jack.call('POST', `/groups/${home.id}/expenses`, expense({ paidBy: jack.id }));

  for (const [method, path, body] of [
    ['GET', `/groups/${home.id}`],
    ['GET', `/groups/${home.id}/history`],
    ['POST', `/groups/${home.id}/expenses`, expense({ paidBy: sam.id })],
    ['POST', `/groups/${home.id}/settle`, { balanceToken: 'x' }],
    ['PUT', `/expenses/${created.id}`, expense({ paidBy: sam.id })],
    ['DELETE', `/expenses/${created.id}`],
  ]) {
    assert.equal((await sam.call(method, path, body)).status, 404, `${method} ${path}`);
  }
});

test('groups: adding a member lets them in and shows in activity', async (t) => {
  const { jack, jaime, home, addSam } = await setup(t);
  const sam = await addSam();

  assert.equal((await jaime.call('POST', `/groups/${home.id}/members`, { userId: sam.id })).body.field, 'userId');
  const added = await jack.call('POST', `/groups/${home.id}/members`, { userId: sam.id });
  assert.equal(added.status, 201);
  assert.deepEqual(added.body.members.map((m) => m.name), ['Jack', 'Jaime', 'Sam']);
  assert.equal((await jack.call('POST', `/groups/${home.id}/members`, { userId: sam.id })).status, 409);
  assert.equal((await sam.call('GET', `/groups/${home.id}`)).status, 200);
});

// ---------- Expenses ----------

test('expenses: the two-person options give the right balances', async (t) => {
  const { jack, jaime, home } = await setup(t);
  const add = (who, overrides) => who.call('POST', `/groups/${home.id}/expenses`, expense(overrides));

  const first = await add(jack, { paidBy: jack.id }); // Jaime owes 25
  assert.equal(first.status, 201);
  assert.deepEqual(first.body.shares, { [jack.id]: 2500, [jaime.id]: 2500 });
  await add(jack, { description: 'Her lunch', amount: '12', paidBy: jack.id, split: 'full', owedBy: jaime.id }); // +12
  await add(jack, { description: 'Dinner', amount: '30', paidBy: jaime.id }); // -15
  await add(jaime, { description: 'His coffee', amount: '8.50', paidBy: jaime.id, split: 'full', owedBy: jack.id }); // -8.50

  const { body } = await jack.call('GET', `/groups/${home.id}`);
  assert.equal(body.ledger.expenses.length, 4);
  assert.deepEqual(body.ledger.balances, { [jack.id]: 1350, [jaime.id]: -1350 });
  assert.deepEqual(body.ledger.transfers, [{ fromUserId: jaime.id, toUserId: jack.id, amountCents: 1350 }]);
});

test('expenses: split between some of a larger group', async (t) => {
  const { jack, jaime, home, addSam } = await setup(t);
  const sam = await addSam();
  await jack.call('POST', `/groups/${home.id}/members`, { userId: sam.id });

  const all = await jack.call('POST', `/groups/${home.id}/expenses`, expense({ amount: '100', paidBy: jack.id }));
  assert.deepEqual(all.body.shares, { [jack.id]: 3334, [jaime.id]: 3333, [sam.id]: 3333 });

  const some = await sam.call('POST', `/groups/${home.id}/expenses`,
    expense({ amount: '20', paidBy: sam.id, participants: [jaime.id, sam.id] }));
  assert.deepEqual(some.body.shares, { [jaime.id]: 1000, [sam.id]: 1000 });

  const { body } = await jaime.call('GET', `/groups/${home.id}`);
  assert.deepEqual(body.ledger.balances, { [jack.id]: 6666, [jaime.id]: -4333, [sam.id]: -2333 });
  assert.equal(body.ledger.transfers.length, 2);
});

test('expenses: invalid input names the offending field', async (t) => {
  const { jack, jaime, home, addSam } = await setup(t);
  const sam = await addSam();
  const cases = [
    [{ description: '   ' }, 'description'],
    [{ description: 'x'.repeat(101) }, 'description'],
    [{ amount: '0' }, 'amount'],
    [{ amount: '12.345' }, 'amount'],
    [{ paidBy: sam.id }, 'paidBy'], // not in the group
    [{ paidBy: String(jack.id) }, 'paidBy'],
    [{ split: 'thirds' }, 'split'],
    [{ participants: [] }, 'participants'],
    [{ participants: [jack.id, sam.id] }, 'participants'],
    [{ split: 'full' }, 'owedBy'],
    [{ split: 'full', owedBy: jack.id }, 'owedBy'], // owing yourself
    [{ spentOn: '2026-02-30' }, 'spentOn'],
  ];
  for (const [overrides, field] of cases) {
    const res = await jack.call('POST', `/groups/${home.id}/expenses`, expense({ paidBy: jack.id, ...overrides }));
    assert.equal(res.status, 400, JSON.stringify(overrides));
    assert.equal(res.body.field, field, JSON.stringify(overrides));
  }
  assert.equal((await jaime.call('GET', `/groups/${home.id}`)).body.ledger.expenses.length, 0);
});

test('expenses: either member can edit or delete; settled ones are locked', async (t) => {
  const { jack, jaime, home } = await setup(t);
  const { body: created } = await jack.call('POST', `/groups/${home.id}/expenses`, expense({ paidBy: jack.id }));

  const edited = await jaime.call('PUT', `/expenses/${created.id}`,
    expense({ description: 'Big shop', amount: '80', paidBy: jack.id, split: 'full', owedBy: jaime.id }));
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.shares, { [jaime.id]: 8000 });
  assert.ok(edited.body.updatedAt);

  assert.equal((await jaime.call('DELETE', `/expenses/${created.id}`)).status, 204);
  assert.equal((await jack.call('DELETE', `/expenses/${created.id}`)).status, 404);

  const { body: kept } = await jack.call('POST', `/groups/${home.id}/expenses`, expense({ paidBy: jack.id }));
  const token = (await jack.call('GET', `/groups/${home.id}`)).body.ledger.balanceToken;
  await jack.call('POST', `/groups/${home.id}/settle`, { balanceToken: token });
  assert.equal((await jack.call('PUT', `/expenses/${kept.id}`, expense({ paidBy: jack.id }))).body.error, 'settled');
  assert.equal((await jack.call('DELETE', `/expenses/${kept.id}`)).body.error, 'settled');
});

// ---------- Settling up ----------

test('settle up archives the group ledger with the payments that square everyone', async (t) => {
  const { jack, jaime, home, addSam } = await setup(t);
  const sam = await addSam();
  await jack.call('POST', `/groups/${home.id}/members`, { userId: sam.id });
  await jack.call('POST', `/groups/${home.id}/expenses`, expense({ amount: '90', paidBy: jack.id })); // each 30
  await jaime.call('POST', `/groups/${home.id}/expenses`, expense({ description: 'Dinner', amount: '30', paidBy: jaime.id })); // each 10
  // Net: Jack +60-10 = 50, Jaime -30+20 = -10, Sam -40

  const ledger = (await sam.call('GET', `/groups/${home.id}`)).body.ledger;
  const res = await sam.call('POST', `/groups/${home.id}/settle`, { balanceToken: ledger.balanceToken });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.payments, [
    { fromUserId: sam.id, toUserId: jack.id, amountCents: 4000 },
    { fromUserId: jaime.id, toUserId: jack.id, amountCents: 1000 },
  ]);
  assert.equal(res.body.expenses.length, 2);

  const after = (await jack.call('GET', `/groups/${home.id}`)).body.ledger;
  assert.deepEqual(after.expenses, []);
  assert.deepEqual(after.transfers, []);

  const history = (await jaime.call('GET', `/groups/${home.id}/history`)).body.settlements;
  assert.equal(history.length, 1);
  assert.equal(history[0].expenseCount, 2);
  assert.equal(history[0].totalCents, 12000);
  assert.equal(history[0].payments.length, 2);

  const detail = await jaime.call('GET', `/settlements/${res.body.id}`);
  assert.equal(detail.body.settlement.groupName, 'Home');
  assert.equal(detail.body.people[sam.id].name, 'Sam');
});

test('settle up refuses a stale view and an empty ledger', async (t) => {
  const { jack, jaime, home } = await setup(t);
  assert.equal((await jack.call('POST', `/groups/${home.id}/settle`, {})).body.field, 'balanceToken');
  const empty = (await jack.call('GET', `/groups/${home.id}`)).body.ledger.balanceToken;
  assert.equal((await jack.call('POST', `/groups/${home.id}/settle`, { balanceToken: empty })).body.error, 'nothing_to_settle');

  await jack.call('POST', `/groups/${home.id}/expenses`, expense({ paidBy: jack.id }));
  const seen = (await jack.call('GET', `/groups/${home.id}`)).body.ledger.balanceToken;
  // Even an expense that nets to nothing counts as a change.
  await jaime.call('POST', `/groups/${home.id}/expenses`, expense({ amount: '10', paidBy: jaime.id, split: 'equal', participants: [jaime.id] }));

  const res = await jack.call('POST', `/groups/${home.id}/settle`, { balanceToken: seen });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'ledger_changed');
  assert.equal((await jack.call('GET', `/groups/${home.id}/history`)).body.settlements.length, 0);
});

test('settlements of other groups are hidden', async (t) => {
  const { jack, home, addSam } = await setup(t);
  const sam = await addSam();
  await jack.call('POST', `/groups/${home.id}/expenses`, expense({ paidBy: jack.id }));
  const token = (await jack.call('GET', `/groups/${home.id}`)).body.ledger.balanceToken;
  const { body: settlement } = await jack.call('POST', `/groups/${home.id}/settle`, { balanceToken: token });
  assert.equal((await sam.call('GET', `/settlements/${settlement.id}`)).status, 404);
  assert.equal((await jack.call('GET', '/settlements/9999')).status, 404);
});

// ---------- Activity ----------

test('activity: a newest-first feed of what happened in your groups and friendships', async (t) => {
  const { jack, jaime, home, addSam } = await setup(t);
  const { body: created } = await jaime.call('POST', `/groups/${home.id}/expenses`, expense({ paidBy: jaime.id }));
  await jack.call('PUT', `/expenses/${created.id}`, expense({ amount: '60', paidBy: jaime.id }));
  await jack.call('DELETE', `/expenses/${created.id}`);
  const sam = await addSam();

  const jaimeFeed = (await jaime.call('GET', '/activity')).body;
  assert.deepEqual(jaimeFeed.items.map((a) => a.type), ['expense_deleted', 'expense_updated', 'expense_added', 'group_created', 'friend_added']);
  const added = jaimeFeed.items.find((a) => a.type === 'expense_added');
  assert.equal(added.actorId, jaime.id);
  assert.equal(added.groupName, 'Home');
  assert.equal(added.data.description, 'Groceries');
  assert.deepEqual(added.data.shares, { [jack.id]: 2500, [jaime.id]: 2500 });
  assert.equal(jaimeFeed.people[jack.id].name, 'Jack');

  // Sam only sees being added as a friend, not Home's history.
  assert.deepEqual((await sam.call('GET', '/activity')).body.items.map((a) => a.type), ['friend_added']);
});

test('activity: pages backwards with a cursor', async (t) => {
  const { jack, home } = await setup(t);
  for (let i = 0; i < 35; i++) {
    await jack.call('POST', `/groups/${home.id}/expenses`, expense({ description: `Item ${i}`, paidBy: jack.id }));
  }
  const first = (await jack.call('GET', '/activity')).body;
  assert.equal(first.items.length, 30);
  assert.ok(first.nextBefore);
  const second = (await jack.call('GET', `/activity?before=${first.nextBefore}`)).body;
  assert.equal(second.items.length, 7); // 5 more expenses + group created + friend added
  assert.equal(second.nextBefore, null);
  assert.equal((await jack.call('GET', '/activity?before=abc')).status, 400);
});

// ---------- Misc ----------

test('shared ledger rules are served to the browser', async (t) => {
  const { base } = await startServer(t);
  const res = await fetch(`${base}/shared/ledger.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
});

test('malformed JSON gets a JSON error, not an HTML page', async (t) => {
  const { base } = await startServer(t, { devLogin: true });
  const res = await fetch(`${base}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_json');
});
