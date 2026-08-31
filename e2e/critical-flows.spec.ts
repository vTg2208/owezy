import { expect, test, type Page } from '@playwright/test';

const member = { id: 'member-1', trip_id: 'trip-1', name: 'Test Traveller', is_admin: 1, created_at: '2026-08-31T00:00:00Z' };
const friend = { id: 'member-2', trip_id: 'trip-1', name: 'Asha', is_admin: 0, created_at: '2026-08-31T00:00:00Z' };

function snapshot(expenses: unknown[] = [], locked = false) {
  return {
    trip: { id: 'trip-1', name: 'Goa notebook', room_code: 'GOA123', admin_id: member.id, is_locked: locked ? 1 : 0, created_at: '2026-08-31T00:00:00Z', currency: 'INR' },
    capabilities: { receipt_uploads: false },
    current_member_id: member.id,
    participants: [member, friend],
    expenses,
    balances: [{ memberId: member.id, memberName: member.name, balance: -500 }, { memberId: friend.id, memberName: friend.name, balance: 500 }],
    settlements: [{ from: friend.id, to: member.id, amount: 500, fromName: friend.name, toName: member.name }],
  };
}

async function installApi(page: Page) {
  const expenses: unknown[] = [];
  let locked = false;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/auth/my-trips')) return json({ trips: [snapshot().trip] });
    if (path.endsWith('/auth/sync')) return json({ user: { id: 'e2e-user' } });
    if (path.endsWith('/auth/me') && method === 'DELETE') return json({ success: true });
    if (path.endsWith('/trips') && method === 'POST') return json({ tripId: 'trip-1', roomCode: 'GOA123', member });
    if (path.endsWith('/trips/join') && method === 'POST') return json({ tripId: 'trip-1', tripName: 'Goa notebook', member });
    if (/\/trips\/trip-1$/.test(path) && method === 'GET') return json(snapshot(expenses, locked));
    if (path.endsWith('/lock') && method === 'POST') { locked = true; return json({ success: true }); }
    if (path.endsWith('/unlock') && method === 'POST') { locked = false; return json({ success: true }); }
    if (path.endsWith('/payments') && method === 'GET') return json({ payments: [{ id: 'payment-1', status: 'pending', payer_membership_id: friend.id, payee_membership_id: member.id, amount: '500.00', currency: 'INR' }] });
    if (path.endsWith('/expenses') && method === 'POST') {
      const body = request.postDataJSON();
      expenses.push({ id: 'expense-1', trip_id: 'trip-1', paid_by: member.id, paid_by_name: member.name, amount: Number(body.amount), description: body.description, split_type: body.splitType, created_at: '2026-08-31T00:00:00Z', version: 1 });
      return json({ expenseId: 'expense-1', splitType: body.splitType, memberCount: body.splits.length });
    }
    if (path.endsWith('/payments/payment-1/confirm') && method === 'POST') return json({ id: 'payment-1', status: 'confirmed' });
    if (path.endsWith('/messages')) return json(method === 'GET' ? { messages: [] } : { messageId: 'message-1', success: true });
    if (path.endsWith('/audit')) return json({ events: [] });
    return json({ success: true });
  });
}

test.beforeEach(async ({ page }) => { await installApi(page); });

test('registration and login stubs reach the authenticated dashboard', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Full name').fill('Test Traveller');
  await page.getByLabel('Email').fill('traveller@example.com');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('Verify');
  await page.getByLabel('Email').fill('traveller@example.com');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Test Traveller' })).toBeVisible();
});

test('a traveller can create and join trips', async ({ page }) => {
  await page.goto('/home?mode=create');
  await page.getByLabel('Trip name').fill('Goa notebook');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page).toHaveURL(/\/trip\/trip-1$/);
  await page.goto('/home?mode=join');
  await page.getByLabel('Room code').fill('goa123');
  await page.getByRole('button', { name: 'Join trip' }).click();
  await expect(page.getByRole('heading', { name: 'Goa notebook' })).toBeVisible();
});

test('expense entry preserves the entered amount and description', async ({ page }) => {
  await page.goto('/trip/trip-1');
  await page.getByLabel('Amount (₹)').fill('101.01');
  await page.getByLabel('Description').fill('Airport chai');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByText('Airport chai')).toBeVisible();
  await expect(page.getByText('₹101.01')).toBeVisible();
});

test('closing a room blocks new travellers without blocking expenses', async ({ page }) => {
  await page.goto('/trip/trip-1');
  await page.getByRole('button', { name: 'Close room' }).click();
  await expect(page.getByText('Room closed to new travellers. Existing travellers can keep adding expenses and settling balances.')).toBeVisible();
  await expect(page.getByLabel('Receipt image')).toHaveCount(0);
  await page.getByRole('textbox', { name: /^Amount/ }).fill('42.50');
  await page.getByLabel('Description').fill('Sunset snacks');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByText('Sunset snacks')).toBeVisible();
});

test('the payment recipient can confirm a pending payment', async ({ page }) => {
  await page.goto('/trip/trip-1');
  await page.getByRole('tab', { name: 'Settlement' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('tab', { name: 'Settlement' })).toHaveAttribute('aria-selected', 'true');
});

test('a direct trip URL restores membership from the server snapshot', async ({ page }) => {
  await page.goto('/trip/trip-1');
  await expect(page.getByRole('heading', { name: 'Goa notebook' })).toBeVisible();
  await expect(page.getByText('Test Traveller').first()).toBeVisible();
});

test('account deletion requires an inline confirmation', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByRole('heading', { name: 'Permanently delete your account?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('core pages do not introduce horizontal page overflow', async ({ page }) => {
  test.setTimeout(60_000);
  for (const path of ['/', '/login', '/register', '/dashboard', '/home?mode=create', '/trip/trip-1']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} should fit the viewport`).toBeLessThanOrEqual(1);
  }

  for (const tab of ['Balances', 'Settlement', 'Chat', 'Activity']) {
    await page.getByRole('tab', { name: tab }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${tab} should fit the viewport`).toBeLessThanOrEqual(1);
  }
});
