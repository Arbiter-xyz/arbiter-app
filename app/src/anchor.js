import { getAccount, getNetwork, getBalance, withdraw } from './api.js';
import { formatAmount } from './format.js';
import { showToast } from './toast.js';

const WITHDRAW_MIN = 0.01;

function parseAmount(raw) {
  const value = Number.parseFloat(String(raw).trim());
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function validateWithdraw(amount, balance) {
  if (amount === null) {
    return 'Enter a valid amount.';
  }
  if (amount < WITHDRAW_MIN) {
    return `Minimum withdrawal is ${formatAmount(WITHDRAW_MIN)}.`;
  }
  if (amount > balance) {
    return 'Amount exceeds available balance.';
  }
  return null;
}

export async function initBankWithdraw(root) {
  if (!root) {
    return;
  }

  const form = root.querySelector('[data-withdraw-form]');
  const input = root.querySelector('[data-withdraw-amount]');
  const submit = root.querySelector('[data-withdraw-submit]');
  const balanceEl = root.querySelector('[data-withdraw-balance]');

  if (!form || !input || !submit) {
    return;
  }

  const account = getAccount();
  const network = getNetwork();

  let balance = 0;
  try {
    balance = await getBalance(account, network);
  } catch (err) {
    showToast('Unable to load balance.', 'error');
    submit.disabled = true;
    return;
  }

  if (balanceEl) {
    balanceEl.textContent = formatAmount(balance);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const amount = parseAmount(input.value);
    const error = validateWithdraw(amount, balance);
    if (error) {
      showToast(error, 'error');
      return;
    }

    submit.disabled = true;
    try {
      await withdraw(account, network, amount);
      balance -= amount;
      if (balanceEl) {
        balanceEl.textContent = formatAmount(balance);
      }
      input.value = '';
      showToast('Withdrawal submitted.', 'success');
    } catch (err) {
      showToast('Withdrawal failed. Please try again.', 'error');
    } finally {
      submit.disabled = false;
    }
  });
}
