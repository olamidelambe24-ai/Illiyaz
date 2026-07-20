import { useState, useEffect, useMemo, useRef } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  LayoutDashboard, CalendarDays, Receipt, Target, TrendingUp,
  Plus, Trash2, Loader2, ArrowUpRight, ArrowDownRight, Wallet,
  UserCircle, LogOut,
} from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import {
  fetchExpensesRows, insertExpenseRow, deleteExpenseRow, clearExpensesRows,
  fetchInvestmentsRows, insertInvestmentRow, deleteInvestmentRow, clearInvestmentsRows,
  fetchSettingsRow, upsertSettingsRow,
} from "./lib/api";

/* ---------------------------------------------------------------------- */
/* Constants                                                               */
/* ---------------------------------------------------------------------- */

const EXPENSE_CATEGORIES = [
  "Transport", "Feeding", "Data & Subscriptions", "Rent",
  "Utilities (Light/Water)", "Health", "Airtime", "Entertainment",
  "Shopping", "Personal Care", "Family Support", "Others",
];

const CATEGORY_COLORS = [
  "#25D366", "#128C7E", "#34B7F1", "#F5A623",
  "#E14B4B", "#7C6FF0", "#FF8A65", "#4DB6AC",
  "#FFC93C", "#6FCF97", "#56CCF2", "#A6B3AC",
];

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Debit Card", "POS", "Mobile Wallet"];

const INVESTMENT_TYPES = [
  "Stocks", "Mutual Fund", "Crypto", "Real Estate", "Fixed Deposit/Bonds",
  "Treasury Bills", "Business", "Savings Plan", "Other",
];

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "daily", label: "Daily", icon: CalendarDays },
  { id: "expenses", label: "Expenses", icon: Receipt },
  { id: "budget", label: "Budget", icon: Target },
  { id: "investments", label: "Investments", icon: TrendingUp },
  { id: "profile", label: "Profile", icon: UserCircle },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function thisMonthStr() {
  return new Date().toISOString().slice(0, 7);
}
function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return uid();
}
function defaultBudgets() {
  const b = {};
  EXPENSE_CATEGORIES.forEach((c) => (b[c] = 0));
  b["Transport"] = 20000;
  b["Feeding"] = 60000;
  b["Data & Subscriptions"] = 10000;
  return b;
}
function mapExpenseFromDb(row) {
  return {
    id: row.id, date: row.date, category: row.category,
    description: row.description || "", payment: row.payment || "",
    amount: Number(row.amount), notes: row.notes || "",
  };
}
function mapInvestmentFromDb(row) {
  return {
    id: row.id, name: row.name, type: row.type, date: row.date,
    amount: Number(row.amount), currentValue: Number(row.current_value),
    notes: row.notes || "",
  };
}

function formatNaira(n, opts = {}) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}₦${Math.abs(Math.round(v)).toLocaleString("en-NG")}${opts.suffix || ""}`;
}
function daysInMonth(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function budgetStatus(spent, budget) {
  if (!budget) return { label: "No budget set", tone: "dim" };
  if (spent > budget) return { label: "Over budget", tone: "danger" };
  if (spent >= 0.9 * budget) return { label: "Near limit", tone: "warn" };
  return { label: "On track", tone: "good" };
}

/* ---------------------------------------------------------------------- */
/* Small building blocks                                                   */
/* ---------------------------------------------------------------------- */

function KpiCard({ label, value, sub, tone = "default", icon: Icon }) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {Icon && <Icon size={16} className="kpi-icon" aria-hidden="true" />}
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function ProgressBar({ pct, tone }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="pbar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`pbar-fill pbar-${tone}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function StatusPill({ tone, label }) {
  return <span className={`pill pill-${tone}`}>{label}</span>;
}

function SectionHeader({ eyebrow, title, desc }) {
  return (
    <div className="section-header">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {desc && <p className="section-desc">{desc}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* App                                                                      */
/* ---------------------------------------------------------------------- */

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [authMode, setAuthMode] = useState("signin");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [state, setState] = useState(null); // { month, expenses, investments, budgets }
  const [dataLoading, setDataLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState("");
  const saveTimer = useRef(null);
  const toastTimer = useRef(null);

  // Track the auth session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load this user's data whenever they sign in
  useEffect(() => {
    if (!session) {
      setState(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDataLoading(true);
      try {
        const [expenseRows, investmentRows, settingsRow] = await Promise.all([
          fetchExpensesRows(), fetchInvestmentsRows(), fetchSettingsRow(session.user.id),
        ]);
        if (cancelled) return;
        let settings = settingsRow;
        if (!settings) {
          settings = { month: thisMonthStr(), budgets: defaultBudgets() };
          await upsertSettingsRow(session.user.id, settings);
        }
        setState({
          month: settings.month || thisMonthStr(),
          budgets: { ...defaultBudgets(), ...(settings.budgets || {}) },
          expenses: expenseRows.map(mapExpenseFromDb),
          investments: investmentRows.map(mapInvestmentFromDb),
        });
      } catch (e) {
        if (!cancelled) {
          showToast("Could not load your data — check your connection");
          setState({ month: thisMonthStr(), budgets: defaultBudgets(), expenses: [], investments: [] });
        }
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Save month/budget changes (debounced)
  useEffect(() => {
    if (!session || !state || dataLoading) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      upsertSettingsRow(session.user.id, { month: state.month, budgets: state.budgets }).catch(() => {
        showToast("Could not save budget — check your connection");
      });
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [state && state.month, state && state.budgets, session, dataLoading]);

  function showToast(msg) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }

  async function addExpense(exp) {
    const id = newId();
    setState((s) => ({ ...s, expenses: [{ ...exp, id }, ...s.expenses] }));
    showToast("Expense added");
    try {
      await insertExpenseRow({
        id, user_id: session.user.id, date: exp.date, category: exp.category,
        description: exp.description, payment: exp.payment, amount: exp.amount, notes: exp.notes,
      });
    } catch (e) {
      showToast("Could not save — check your connection");
      setState((s) => ({ ...s, expenses: s.expenses.filter((x) => x.id !== id) }));
    }
  }

  async function deleteExpense(id) {
    const prevExpenses = state.expenses;
    setState((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) }));
    try {
      await deleteExpenseRow(id);
    } catch (e) {
      showToast("Could not delete — try again");
      setState((s) => ({ ...s, expenses: prevExpenses }));
    }
  }

  async function addInvestment(inv) {
    const id = newId();
    setState((s) => ({ ...s, investments: [{ ...inv, id }, ...s.investments] }));
    showToast("Investment added");
    try {
      await insertInvestmentRow({
        id, user_id: session.user.id, name: inv.name, type: inv.type, date: inv.date,
        amount: inv.amount, current_value: inv.currentValue, notes: inv.notes,
      });
    } catch (e) {
      showToast("Could not save — check your connection");
      setState((s) => ({ ...s, investments: s.investments.filter((x) => x.id !== id) }));
    }
  }

  async function deleteInvestment(id) {
    const prevInvestments = state.investments;
    setState((s) => ({ ...s, investments: s.investments.filter((i) => i.id !== id) }));
    try {
      await deleteInvestmentRow(id);
    } catch (e) {
      showToast("Could not delete — try again");
      setState((s) => ({ ...s, investments: prevInvestments }));
    }
  }

  function setBudget(cat, val) {
    setState((s) => ({ ...s, budgets: { ...s.budgets, [cat]: val } }));
  }
  function setMonth(m) {
    setState((s) => ({ ...s, month: m }));
  }

  async function handleAuthSubmit(email, password) {
    setAuthError("");
    setAuthLoading(true);
    try {
      if (authMode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        showToast("Account created — check your email if confirmation is required");
      }
    } catch (e) {
      setAuthError(e.message || "Something went wrong. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setTab("dashboard");
  }

  async function handleClearData() {
    if (!window.confirm("Delete all your expenses, investments and budget? This can't be undone.")) return;
    try {
      await Promise.all([clearExpensesRows(session.user.id), clearInvestmentsRows(session.user.id)]);
      const fresh = { month: thisMonthStr(), budgets: defaultBudgets() };
      await upsertSettingsRow(session.user.id, fresh);
      setState({ ...fresh, expenses: [], investments: [] });
      showToast("Your data has been cleared");
    } catch (e) {
      showToast("Could not clear data — try again");
    }
  }

  return (
    <div className="app-root">
      <style>{GLOBAL_CSS}</style>

      {session === undefined ? (
        <LoadingScreen text="Checking your session…" />
      ) : session === null ? (
        <AuthScreen
          mode={authMode}
          setMode={setAuthMode}
          onSubmit={handleAuthSubmit}
          loading={authLoading}
          error={authError}
        />
      ) : dataLoading || !state ? (
        <LoadingScreen text="Loading your ledger…" />
      ) : (
        <div className="app">
          <nav className="sidebar" aria-label="Main navigation">
            <div className="brand">
              <Wallet size={20} aria-hidden="true" />
              <span>Illy Tracker</span>
            </div>

            <div className="nav-list">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    className={`nav-btn ${active ? "nav-btn-active" : ""}`}
                    onClick={() => setTab(t.id)}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-label">{t.label}</span>
                  </button>
                );
              })}
            </div>

            <button className="sidebar-user" onClick={() => setTab("profile")} aria-label="Open profile">
              <span className="sidebar-user-avatar">{session.user.email[0].toUpperCase()}</span>
              <span className="sidebar-user-email nav-label">{session.user.email}</span>
            </button>
            <button className="reset-btn" onClick={handleSignOut}>
              <LogOut size={14} aria-hidden="true" />
              <span className="nav-label">Sign out</span>
            </button>
          </nav>

          <main className="main">
            {tab === "dashboard" && <Dashboard state={state} />}
            {tab === "daily" && <Daily state={state} setMonth={setMonth} />}
            {tab === "expenses" && (
              <Expenses state={state} addExpense={addExpense} deleteExpense={deleteExpense} />
            )}
            {tab === "budget" && (
              <BudgetTab state={state} setBudget={setBudget} setMonth={setMonth} />
            )}
            {tab === "investments" && (
              <Investments state={state} addInvestment={addInvestment} deleteInvestment={deleteInvestment} />
            )}
            {tab === "profile" && (
              <Profile session={session} state={state} onSignOut={handleSignOut} onClearData={handleClearData} />
            )}
          </main>

          <div className={`toast ${toast ? "toast-show" : ""}`} role="status" aria-live="polite">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Auth, Profile, Loading                                                  */
/* ---------------------------------------------------------------------- */

function LoadingScreen({ text }) {
  return (
    <div className="loading-screen">
      <Loader2 className="spin" size={28} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function AuthScreen({ mode, setMode, onSubmit, loading, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(email, password);
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand auth-brand">
          <Wallet size={22} aria-hidden="true" />
          <span>Illy Tracker</span>
        </div>
        <p className="auth-sub">
          {mode === "signin" ? "Welcome back — sign in to your private ledger." : "Create your own private ledger."}
        </p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            <span>Email</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password" required minLength={6} value={password}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="btn-primary auth-submit" type="submit" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : (mode === "signin" ? "Sign in" : "Create account")}
          </button>
        </form>
        <button className="auth-toggle" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); }}>
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

function Profile({ session, state, onSignOut, onClearData }) {
  const email = session.user.email;
  const joined = session.user.created_at
    ? new Date(session.user.created_at).toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" })
    : "—";
  const budgetsSet = Object.values(state.budgets).filter((v) => Number(v) > 0).length;

  return (
    <div>
      <SectionHeader eyebrow="Account" title="Profile" desc="Your ledger is private — only you can sign in and see it." />

      <div className="card profile-card">
        <div className="profile-avatar">{email[0].toUpperCase()}</div>
        <div>
          <div className="profile-email">{email}</div>
          <div className="profile-meta">Member since {joined}</div>
        </div>
      </div>

      <div className="kpi-grid kpi-grid-3">
        <KpiCard label="Expenses logged" value={state.expenses.length} icon={Receipt} />
        <KpiCard label="Investments tracked" value={state.investments.length} icon={TrendingUp} />
        <KpiCard label="Budget categories set" value={budgetsSet} icon={Target} />
      </div>

      <div className="card">
        <h2>Account actions</h2>
        <div className="profile-actions">
          <button className="btn-secondary" onClick={onSignOut}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
          <button className="btn-danger" onClick={onClearData}>
            <Trash2 size={15} aria-hidden="true" /> Clear all my data
          </button>
        </div>
        <p className="section-desc" style={{ marginTop: 14 }}>
          Clearing your data permanently deletes your expenses, investments and budget from your account. This cannot be undone.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Dashboard                                                                */
/* ---------------------------------------------------------------------- */

function Dashboard({ state }) {
  const month = state.month;
  const monthExpenses = state.expenses.filter((e) => e.date.slice(0, 7) === month);
  const monthTotal = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const allTimeTotal = state.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  const totalBudget = EXPENSE_CATEGORIES.reduce((s, c) => s + Number(state.budgets[c] || 0), 0);
  const remaining = totalBudget - monthTotal;
  const status = budgetStatus(monthTotal, totalBudget);

  const totalInvested = state.investments.reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalCurrent = state.investments.reduce((s, i) => s + Number(i.currentValue || 0), 0);
  const gain = totalCurrent - totalInvested;
  const roi = totalInvested ? gain / totalInvested : 0;

  const pieData = EXPENSE_CATEGORIES.map((cat) => ({
    name: cat,
    value: monthExpenses.filter((e) => e.category === cat).reduce((s, e) => s + Number(e.amount || 0), 0),
  })).filter((d) => d.value > 0);

  const invByType = INVESTMENT_TYPES.map((t) => ({
    type: t,
    invested: state.investments.filter((i) => i.type === t).reduce((s, i) => s + Number(i.amount || 0), 0),
    current: state.investments.filter((i) => i.type === t).reduce((s, i) => s + Number(i.currentValue || 0), 0),
  })).filter((d) => d.invested > 0 || d.current > 0);

  return (
    <div>
      <SectionHeader
        eyebrow={new Date(month + "-01").toLocaleDateString("en-NG", { month: "long", year: "numeric" })}
        title="Dashboard"
        desc="A snapshot of your spending, budget pace and investment growth."
      />

      <div className="kpi-grid">
        <KpiCard label="Spent this month" value={formatNaira(monthTotal)} sub={`All-time: ${formatNaira(allTimeTotal)}`} tone="danger" icon={Receipt} />
        <KpiCard label="Monthly budget" value={formatNaira(totalBudget)} sub={<StatusPill tone={status.tone} label={status.label} />} tone="gold" icon={Target} />
        <KpiCard label="Budget remaining" value={formatNaira(remaining)} sub={remaining < 0 ? "over plan" : "left to spend"} tone={remaining < 0 ? "danger" : "good"} icon={Wallet} />
        <KpiCard
          label="Investment value"
          value={formatNaira(totalCurrent)}
          sub={
            <span className={gain >= 0 ? "delta-up" : "delta-down"}>
              {gain >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {formatNaira(Math.abs(gain))} ({(roi * 100).toFixed(1)}%)
            </span>
          }
          tone="blue"
          icon={TrendingUp}
        />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Spending by category — this month</h2>
          {pieData.length === 0 ? (
            <EmptyNote text="No expenses logged for this month yet." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {pieData.map((entry, i) => (
                    <Cell key={entry.name} fill={CATEGORY_COLORS[EXPENSE_CATEGORIES.indexOf(entry.name) % CATEGORY_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatNaira(v)} contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-dim)" }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2>Budget pace by category</h2>
          <div className="budget-mini-list">
            {EXPENSE_CATEGORIES.filter((c) => state.budgets[c] > 0).length === 0 && (
              <EmptyNote text="Set budgets on the Budget tab to see pacing here." />
            )}
            {EXPENSE_CATEGORIES.filter((c) => state.budgets[c] > 0).map((cat) => {
              const spent = monthExpenses.filter((e) => e.category === cat).reduce((s, e) => s + Number(e.amount || 0), 0);
              const bud = Number(state.budgets[cat] || 0);
              const st = budgetStatus(spent, bud);
              return (
                <div className="budget-mini-row" key={cat}>
                  <div className="budget-mini-top">
                    <span>{cat}</span>
                    <span className="budget-mini-amt">{formatNaira(spent)} / {formatNaira(bud)}</span>
                  </div>
                  <ProgressBar pct={(spent / bud) * 100} tone={st.tone} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {invByType.length > 0 && (
        <div className="card">
          <h2>Investments — amount invested vs. current value</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={invByType}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="type" tick={{ fill: "var(--text-dim)", fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis tick={{ fill: "var(--text-dim)", fontSize: 11 }} tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatNaira(v)} contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-dim)" }} />
              <Bar dataKey="invested" name="Invested" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="current" name="Current value" fill="var(--accent-emerald)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Daily                                                                    */
/* ---------------------------------------------------------------------- */

function Daily({ state, setMonth }) {
  const month = state.month;
  const nDays = daysInMonth(month);
  const totalBudget = EXPENSE_CATEGORIES.reduce((s, c) => s + Number(state.budgets[c] || 0), 0);
  const dailyBudget = nDays ? totalBudget / nDays : 0;

  let cumSpent = 0;
  let cumBudget = 0;
  const rows = Array.from({ length: nDays }, (_, i) => {
    const day = i + 1;
    const dateStr = `${month}-${String(day).padStart(2, "0")}`;
    const spent = state.expenses.filter((e) => e.date === dateStr).reduce((s, e) => s + Number(e.amount || 0), 0);
    cumSpent += spent;
    cumBudget += dailyBudget;
    const dayLabel = new Date(dateStr + "T00:00:00").toLocaleDateString("en-NG", { weekday: "short" });
    return { day, dateStr, dayLabel, spent, cumSpent, cumBudget, variance: cumBudget - cumSpent };
  });

  const monthTotal = rows.reduce((s, r) => s + r.spent, 0);

  return (
    <div>
      <SectionHeader eyebrow="Day by day" title="Daily Tracker" desc="Every day of the month, pulled straight from your expense log." />

      <div className="toolbar">
        <label className="field-inline">
          <span>Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <div className="toolbar-stat">
          <span>Daily budget pace</span>
          <strong>{formatNaira(dailyBudget)}/day</strong>
        </div>
        <div className="toolbar-stat">
          <span>Month total</span>
          <strong>{formatNaira(monthTotal)}</strong>
        </div>
      </div>

      <div className="card">
        <h2>Cumulative spend vs. budget pace</h2>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="day" tick={{ fill: "var(--text-dim)", fontSize: 11 }} label={{ value: "Day of month", position: "insideBottom", offset: -4, fill: "var(--text-dim)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--text-dim)", fontSize: 11 }} tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => formatNaira(v)} contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-dim)" }} />
            <Line type="monotone" dataKey="cumSpent" name="Cumulative spent" stroke="var(--accent-coral)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="cumBudget" name="Cumulative budget" stroke="var(--accent-gold)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card table-card">
        <h2>Daily breakdown</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Day</th><th className="num">Spent</th><th className="num">Cumulative</th><th className="num">Cum. budget</th><th className="num">Variance</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = budgetStatus(r.cumSpent, r.cumBudget || 0);
                const stTone = totalBudget === 0 ? "dim" : (r.variance < 0 ? "danger" : "good");
                return (
                  <tr key={r.dateStr}>
                    <td>{new Date(r.dateStr + "T00:00:00").toLocaleDateString("en-NG", { day: "2-digit", month: "short" })}</td>
                    <td>{r.dayLabel}</td>
                    <td className="num">{r.spent ? formatNaira(r.spent) : "—"}</td>
                    <td className="num">{formatNaira(r.cumSpent)}</td>
                    <td className="num">{formatNaira(r.cumBudget)}</td>
                    <td className={`num ${r.variance < 0 ? "text-danger" : "text-good"}`}>{formatNaira(r.variance)}</td>
                    <td>{totalBudget === 0 ? <StatusPill tone="dim" label="No budget" /> : <StatusPill tone={stTone} label={stTone === "danger" ? "Over pace" : "On pace"} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Expenses                                                                 */
/* ---------------------------------------------------------------------- */

function Expenses({ state, addExpense, deleteExpense }) {
  const [form, setForm] = useState({
    date: todayISO(), category: EXPENSE_CATEGORIES[0], description: "",
    payment: PAYMENT_METHODS[0], amount: "", notes: "",
  });
  const [filterMonth, setFilterMonth] = useState("all");

  const months = useMemo(() => {
    const set = new Set(state.expenses.map((e) => e.date.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [state.expenses]);

  const rows = useMemo(() => {
    const list = filterMonth === "all" ? state.expenses : state.expenses.filter((e) => e.date.slice(0, 7) === filterMonth);
    return [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [state.expenses, filterMonth]);

  const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) return;
    addExpense({ ...form, amount: Number(form.amount) });
    setForm({ date: todayISO(), category: EXPENSE_CATEGORIES[0], description: "", payment: PAYMENT_METHODS[0], amount: "", notes: "" });
  }

  return (
    <div>
      <SectionHeader eyebrow={`${rows.length} entries`} title="Expenses" desc="Log everyday spend — transport, feeding, subscriptions, and more." />

      <form className="card form-card" onSubmit={handleSubmit}>
        <h2>Add an expense</h2>
        <div className="form-grid">
          <label>
            <span>Date</span>
            <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label>
            <span>Category</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="span-2">
            <span>Description</span>
            <input type="text" placeholder="e.g. Uber to office" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label>
            <span>Payment method</span>
            <select value={form.payment} onChange={(e) => setForm({ ...form, payment: e.target.value })}>
              {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            <span>Amount (₦)</span>
            <input type="number" min="0" step="1" required placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label className="span-2">
            <span>Notes (optional)</span>
            <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>
        <button type="submit" className="btn-primary">
          <Plus size={16} aria-hidden="true" /> Add expense
        </button>
      </form>

      <div className="toolbar">
        <label className="field-inline">
          <span>Filter month</span>
          <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
            <option value="all">All time</option>
            {months.map((m) => (
              <option key={m} value={m}>{new Date(m + "-01").toLocaleDateString("en-NG", { month: "long", year: "numeric" })}</option>
            ))}
          </select>
        </label>
        <div className="toolbar-stat">
          <span>Total shown</span>
          <strong>{formatNaira(total)}</strong>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Category</th><th>Description</th><th>Payment</th><th className="num">Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6}><EmptyNote text="No expenses yet — add your first one above." /></td></tr>
              )}
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.date + "T00:00:00").toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td><span className="cat-dot" style={{ background: CATEGORY_COLORS[EXPENSE_CATEGORIES.indexOf(e.category) % CATEGORY_COLORS.length] }} />{e.category}</td>
                  <td>{e.description || "—"}</td>
                  <td>{e.payment}</td>
                  <td className="num">{formatNaira(e.amount)}</td>
                  <td>
                    <button className="icon-btn" onClick={() => deleteExpense(e.id)} aria-label={`Delete expense: ${e.description || e.category}`}>
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Budget                                                                   */
/* ---------------------------------------------------------------------- */

function BudgetTab({ state, setBudget, setMonth }) {
  const month = state.month;
  const monthExpenses = state.expenses.filter((e) => e.date.slice(0, 7) === month);
  const totalBudget = EXPENSE_CATEGORIES.reduce((s, c) => s + Number(state.budgets[c] || 0), 0);
  const totalSpent = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  return (
    <div>
      <SectionHeader eyebrow="Plan vs. actual" title="Budget" desc="Set what you plan to spend per category, and track it against real spend." />

      <div className="toolbar">
        <label className="field-inline">
          <span>Budget month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <div className="toolbar-stat">
          <span>Total budget</span>
          <strong>{formatNaira(totalBudget)}</strong>
        </div>
        <div className="toolbar-stat">
          <span>Total spent</span>
          <strong>{formatNaira(totalSpent)}</strong>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Category</th><th className="num">Budget</th><th className="num">Actual</th><th className="num">Variance</th><th>Progress</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {EXPENSE_CATEGORIES.map((cat) => {
                const budget = Number(state.budgets[cat] || 0);
                const spent = monthExpenses.filter((e) => e.category === cat).reduce((s, e) => s + Number(e.amount || 0), 0);
                const variance = budget - spent;
                const st = budgetStatus(spent, budget);
                return (
                  <tr key={cat}>
                    <td>{cat}</td>
                    <td className="num">
                      <input
                        type="number" min="0" step="500" className="budget-input"
                        value={budget}
                        onChange={(e) => setBudget(cat, Number(e.target.value))}
                        aria-label={`Monthly budget for ${cat}`}
                      />
                    </td>
                    <td className="num">{formatNaira(spent)}</td>
                    <td className={`num ${variance < 0 ? "text-danger" : "text-good"}`}>{formatNaira(variance)}</td>
                    <td className="progress-cell">
                      {budget > 0 ? <ProgressBar pct={(spent / budget) * 100} tone={st.tone} /> : <span className="text-dim">—</span>}
                    </td>
                    <td><StatusPill tone={st.tone} label={st.label} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{formatNaira(totalBudget)}</td>
                <td className="num">{formatNaira(totalSpent)}</td>
                <td className={`num ${totalBudget - totalSpent < 0 ? "text-danger" : "text-good"}`}>{formatNaira(totalBudget - totalSpent)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Investments                                                              */
/* ---------------------------------------------------------------------- */

function Investments({ state, addInvestment, deleteInvestment }) {
  const [form, setForm] = useState({
    name: "", type: INVESTMENT_TYPES[0], date: todayISO(), amount: "", currentValue: "", notes: "",
  });

  const rows = [...state.investments].sort((a, b) => (a.date < b.date ? 1 : -1));
  const totalInvested = rows.reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalCurrent = rows.reduce((s, i) => s + Number(i.currentValue || 0), 0);
  const totalGain = totalCurrent - totalInvested;
  const totalRoi = totalInvested ? totalGain / totalInvested : 0;

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || !form.amount) return;
    addInvestment({
      ...form,
      amount: Number(form.amount),
      currentValue: form.currentValue === "" ? Number(form.amount) : Number(form.currentValue),
    });
    setForm({ name: "", type: INVESTMENT_TYPES[0], date: todayISO(), amount: "", currentValue: "", notes: "" });
  }

  return (
    <div>
      <SectionHeader eyebrow={`${rows.length} holdings`} title="Investments" desc="Track what you've put in, what it's worth now, and how much you're making." />

      <div className="kpi-grid kpi-grid-3">
        <KpiCard label="Total invested" value={formatNaira(totalInvested)} tone="blue" icon={Wallet} />
        <KpiCard label="Current value" value={formatNaira(totalCurrent)} tone="good" icon={TrendingUp} />
        <KpiCard
          label="Gain / loss"
          value={formatNaira(totalGain)}
          sub={<span className={totalGain >= 0 ? "delta-up" : "delta-down"}>{totalGain >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{(totalRoi * 100).toFixed(1)}% ROI</span>}
          tone={totalGain >= 0 ? "good" : "danger"}
          icon={ArrowUpRight}
        />
      </div>

      <form className="card form-card" onSubmit={handleSubmit}>
        <h2>Add an investment</h2>
        <div className="form-grid">
          <label className="span-2">
            <span>Name</span>
            <input type="text" required placeholder="e.g. GTCO Shares" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            <span>Type</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {INVESTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>
            <span>Date invested</span>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label>
            <span>Amount invested (₦)</span>
            <input type="number" min="0" step="1" required placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label>
            <span>Current value (₦)</span>
            <input type="number" min="0" step="1" placeholder="same as invested" value={form.currentValue} onChange={(e) => setForm({ ...form, currentValue: e.target.value })} />
          </label>
          <label className="span-2">
            <span>Notes (optional)</span>
            <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>
        <button type="submit" className="btn-primary">
          <Plus size={16} aria-hidden="true" /> Add investment
        </button>
      </form>

      <div className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Type</th><th>Date</th><th className="num">Invested</th><th className="num">Current value</th><th className="num">Gain/Loss</th><th className="num">ROI</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8}><EmptyNote text="No investments yet — add your first one above." /></td></tr>
              )}
              {rows.map((i) => {
                const gain = Number(i.currentValue || 0) - Number(i.amount || 0);
                const roi = i.amount ? gain / i.amount : 0;
                return (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td>{i.type}</td>
                    <td>{new Date(i.date + "T00:00:00").toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td className="num">{formatNaira(i.amount)}</td>
                    <td className="num">{formatNaira(i.currentValue)}</td>
                    <td className={`num ${gain < 0 ? "text-danger" : "text-good"}`}>{formatNaira(gain)}</td>
                    <td className={`num ${roi < 0 ? "text-danger" : "text-good"}`}>{(roi * 100).toFixed(1)}%</td>
                    <td>
                      <button className="icon-btn" onClick={() => deleteInvestment(i.id)} aria-label={`Delete investment: ${i.name}`}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <td className="num">{formatNaira(totalInvested)}</td>
                  <td className="num">{formatNaira(totalCurrent)}</td>
                  <td className={`num ${totalGain < 0 ? "text-danger" : "text-good"}`}>{formatNaira(totalGain)}</td>
                  <td className={`num ${totalRoi < 0 ? "text-danger" : "text-good"}`}>{(totalRoi * 100).toFixed(1)}%</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function EmptyNote({ text }) {
  return <div className="empty-note">{text}</div>;
}

const TOOLTIP_STYLE = {
  background: "#FFFFFF",
  border: "1px solid #DCE8E0",
  borderRadius: 12,
  color: "#0B1A12",
  fontSize: 12,
  fontFamily: "Inter, sans-serif",
  boxShadow: "0 8px 24px rgba(7,94,84,0.12)",
};

/* ---------------------------------------------------------------------- */
/* CSS                                                                      */
/* ---------------------------------------------------------------------- */

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&family=Manrope:wght@600;700&display=swap');

:root {
  --bg: #F5F8F6;
  --surface: #FFFFFF;
  --surface-2: #EFF6F1;
  --border: #E1EAE4;
  --text: #10241B;
  --text-dim: #6B7C73;
  --accent-emerald: #25D366;
  --accent-emerald-dark: #128C7E;
  --accent-deep: #075E54;
  --accent-gold: #F5A623;
  --accent-coral: #E14B4B;
  --accent-blue: #34B7F1;
  --shadow-sm: 0 2px 10px rgba(7,94,84,0.06);
  --shadow-md: 0 10px 28px rgba(7,94,84,0.10);
}

* { box-sizing: border-box; }

.app, .loading-screen, .auth-screen {
  font-family: 'Inter', -apple-system, sans-serif;
  color: var(--text);
  background: var(--bg);
  min-height: 100vh;
}

.loading-screen {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; min-height: 400px; color: var(--text-dim); font-size: 14px;
}
.spin { animation: spin 1s linear infinite; color: var(--accent-emerald); }
@keyframes spin { to { transform: rotate(360deg); } }

.app { display: flex; }

/* ---- Sidebar ---- */
.sidebar {
  width: 232px; flex-shrink: 0; background: var(--accent-deep);
  display: flex; flex-direction: column; padding: 22px 14px;
  position: sticky; top: 0; height: 100vh;
}
.brand {
  display: flex; align-items: center; gap: 9px; padding: 6px 10px 22px;
  font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 21px; color: #FFFFFF;
  border-bottom: 1px solid rgba(255,255,255,0.14); margin-bottom: 16px; letter-spacing: -0.01em;
}
.brand svg { color: var(--accent-emerald); }
.nav-list { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.nav-btn {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px;
  background: transparent; border: none; color: rgba(255,255,255,0.72); font-size: 14px; font-weight: 600;
  cursor: pointer; text-align: left; width: 100%; transition: background 0.15s, color 0.15s;
}
.nav-btn:hover { background: rgba(255,255,255,0.08); color: #FFFFFF; }
.nav-btn-active { background: var(--accent-emerald); color: #08321F; }
.nav-btn-active:hover { background: var(--accent-emerald); color: #08321F; }
.reset-btn {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px;
  background: transparent; border: 1px dashed rgba(255,255,255,0.25); color: rgba(255,255,255,0.72);
  font-size: 12.5px; font-weight: 600; cursor: pointer; margin-top: 12px;
}
.reset-btn:hover { color: #FFFFFF; border-color: rgba(255,255,255,0.5); }

.sidebar-user {
  display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 12px;
  margin-top: 10px; border: 1px dashed rgba(255,255,255,0.25); background: transparent; cursor: pointer; width: 100%;
  text-align: left;
}
.sidebar-user:hover { border-color: var(--accent-emerald); }
.sidebar-user-avatar {
  width: 24px; height: 24px; border-radius: 50%; background: rgba(255,255,255,0.14); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #FFFFFF;
}
.sidebar-user-email { font-size: 11.5px; color: rgba(255,255,255,0.72); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- Auth screen ---- */
.auth-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.auth-card {
  width: 100%; max-width: 380px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 22px; padding: 36px 30px; box-shadow: var(--shadow-md);
}
.auth-brand { justify-content: center; border-bottom: none; margin-bottom: 4px; padding-bottom: 0; color: var(--accent-deep); }
.auth-brand svg { color: var(--accent-emerald); }
.auth-sub { color: var(--text-dim); font-size: 13.5px; text-align: center; margin: 0 0 26px; }
.auth-form { display: flex; flex-direction: column; gap: 14px; }
.auth-form label { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--text-dim); font-weight: 600; }
.auth-form input {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px;
  padding: 11px 13px; color: var(--text); font-size: 14px; font-family: inherit;
}
.auth-form input:focus { outline: 2px solid var(--accent-emerald); outline-offset: 1px; border-color: var(--accent-emerald); }
.auth-error { background: rgba(225,75,75,0.1); color: var(--accent-coral); font-size: 12.5px; padding: 10px 13px; border-radius: 10px; }
.auth-submit { justify-content: center; width: 100%; margin-top: 4px; }
.auth-toggle { background: none; border: none; color: var(--text-dim); font-size: 12.5px; margin-top: 20px; width: 100%; text-align: center; cursor: pointer; font-weight: 600; }
.auth-toggle:hover { color: var(--accent-emerald-dark); }

/* ---- Main ---- */
.main { flex: 1; padding: 32px 36px 80px; max-width: 1180px; }
.section-header { margin-bottom: 24px; }
.eyebrow { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent-emerald-dark); font-weight: 700; margin-bottom: 6px; }
.section-header h1 { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 30px; font-weight: 800; margin: 0 0 6px; color: var(--text); letter-spacing: -0.01em; }
.section-desc { color: var(--text-dim); font-size: 14px; margin: 0; max-width: 560px; }

/* ---- KPI cards ---- */
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
.kpi-grid-3 { grid-template-columns: repeat(3, 1fr); }
.kpi {
  background: var(--surface); border: 1px solid var(--border); border-radius: 18px;
  padding: 17px 19px; border-top: 3px solid var(--border); box-shadow: var(--shadow-sm);
}
.kpi-danger { border-top-color: var(--accent-coral); }
.kpi-gold { border-top-color: var(--accent-gold); }
.kpi-good { border-top-color: var(--accent-emerald); }
.kpi-blue { border-top-color: var(--accent-blue); }
.kpi-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 9px; }
.kpi-label { font-size: 12px; color: var(--text-dim); font-weight: 600; }
.kpi-icon { color: var(--text-dim); }
.kpi-value { font-family: 'Manrope', sans-serif; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.kpi-sub { font-size: 12px; color: var(--text-dim); margin-top: 6px; font-weight: 500; }

/* ---- Cards / grids ---- */
.grid-2 { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 16px; margin-bottom: 20px; }
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 18px;
  padding: 22px 24px; margin-bottom: 20px; box-shadow: var(--shadow-sm);
}
.card h2 { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 16px; font-weight: 700; margin: 0 0 14px; color: var(--text); }

.empty-note { color: var(--text-dim); font-size: 13.5px; text-align: center; padding: 24px 8px; }

/* ---- Toolbar ---- */
.toolbar { display: flex; align-items: flex-end; gap: 24px; margin-bottom: 16px; flex-wrap: wrap; }
.field-inline { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-dim); font-weight: 600; }
.field-inline input, .field-inline select {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 8px 11px; color: var(--text); font-size: 13.5px; font-family: inherit;
}
.toolbar-stat { display: flex; flex-direction: column; gap: 2px; }
.toolbar-stat span { font-size: 11.5px; color: var(--text-dim); font-weight: 600; }
.toolbar-stat strong { font-family: 'Manrope', sans-serif; font-size: 15px; font-variant-numeric: tabular-nums; }

/* ---- Forms ---- */
.form-card { border-top: 3px solid var(--accent-emerald); }
.form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 14px; margin-bottom: 16px; }
.form-grid label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-dim); font-weight: 600; }
.form-grid .span-2 { grid-column: span 2; }
.form-grid input, .form-grid select {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px;
  padding: 9px 11px; color: var(--text); font-size: 13.5px; font-family: inherit;
}
.form-grid input:focus, .form-grid select:focus, .field-inline input:focus, .field-inline select:focus {
  outline: 2px solid var(--accent-emerald); outline-offset: 1px; border-color: var(--accent-emerald);
}
.btn-primary {
  display: inline-flex; align-items: center; gap: 8px; background: var(--accent-emerald);
  color: #08321F; border: none; border-radius: 100px; padding: 10px 20px; font-size: 13.5px;
  font-weight: 700; cursor: pointer; transition: filter 0.15s, transform 0.1s;
}
.btn-primary:hover { filter: brightness(1.05); transform: translateY(-1px); }
.btn-primary:focus-visible { outline: 2px solid var(--accent-emerald-dark); outline-offset: 2px; }

/* ---- Table ---- */
.table-card { padding: 20px 0 6px; }
.table-card h2 { padding: 0 24px; }
.table-scroll { overflow-x: auto; padding: 0 24px; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 640px; }
thead th {
  text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--text-dim); font-weight: 700; padding: 10px 10px; border-bottom: 1px solid var(--border);
}
tbody td { padding: 11px 10px; border-bottom: 1px solid var(--border); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--surface-2); }
tfoot td { padding: 12px 10px 6px; font-weight: 700; border-top: 1px solid var(--border); }
.num { text-align: right; font-family: 'Manrope', sans-serif; font-variant-numeric: tabular-nums; }
th.num { text-align: right; }
.text-danger { color: var(--accent-coral); }
.text-good { color: var(--accent-emerald-dark); }
.text-dim { color: var(--text-dim); }
.cat-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; }
.icon-btn {
  background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 6px;
  border-radius: 8px; display: inline-flex;
}
.icon-btn:hover { color: var(--accent-coral); background: var(--surface-2); }
.budget-input {
  width: 110px; text-align: right; background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 9px; padding: 6px 9px; color: var(--text); font-family: 'Manrope', sans-serif; font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.progress-cell { min-width: 110px; }

/* ---- Progress / pills ---- */
.pbar { width: 100%; height: 7px; background: var(--surface-2); border-radius: 6px; overflow: hidden; }
.pbar-fill { height: 100%; border-radius: 6px; }
.pbar-good { background: var(--accent-emerald); }
.pbar-warn { background: var(--accent-gold); }
.pbar-danger { background: var(--accent-coral); }
.pbar-dim { background: var(--border); }
.pill { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 100px; white-space: nowrap; }
.pill-good { background: rgba(37,211,102,0.14); color: var(--accent-emerald-dark); }
.pill-warn { background: rgba(245,166,35,0.14); color: #A06A00; }
.pill-danger { background: rgba(225,75,75,0.12); color: var(--accent-coral); }
.pill-dim { background: var(--surface-2); color: var(--text-dim); }

.delta-up { color: var(--accent-emerald-dark); display: inline-flex; align-items: center; gap: 3px; font-weight: 600; }
.delta-down { color: var(--accent-coral); display: inline-flex; align-items: center; gap: 3px; font-weight: 600; }

.budget-mini-list { display: flex; flex-direction: column; gap: 14px; }
.budget-mini-row { display: flex; flex-direction: column; gap: 6px; }
.budget-mini-top { display: flex; justify-content: space-between; font-size: 13px; font-weight: 500; }
.budget-mini-amt { font-family: 'Manrope', sans-serif; color: var(--text-dim); font-size: 12px; font-variant-numeric: tabular-nums; }

/* ---- Profile page ---- */
.profile-card { display: flex; align-items: center; gap: 16px; }
.profile-avatar {
  width: 54px; height: 54px; border-radius: 50%; background: var(--accent-deep);
  display: flex; align-items: center; justify-content: center; font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 22px; font-weight: 800; color: #FFFFFF; flex-shrink: 0;
}
.profile-email { font-size: 15px; font-weight: 700; }
.profile-meta { font-size: 12.5px; color: var(--text-dim); margin-top: 2px; }
.profile-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.btn-secondary {
  display: inline-flex; align-items: center; gap: 8px; background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text); border-radius: 100px; padding: 9px 17px; font-size: 13px; font-weight: 700; cursor: pointer;
}
.btn-secondary:hover { border-color: var(--accent-emerald-dark); color: var(--accent-emerald-dark); }
.btn-danger {
  display: inline-flex; align-items: center; gap: 8px; background: transparent; border: 1px solid var(--border);
  color: var(--accent-coral); border-radius: 100px; padding: 9px 17px; font-size: 13px; font-weight: 700; cursor: pointer;
}
.btn-danger:hover { background: rgba(225,75,75,0.08); border-color: var(--accent-coral); }

/* ---- Toast ---- */
.toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px);
  background: var(--accent-deep); border: 1px solid var(--accent-deep); color: #FFFFFF;
  padding: 10px 20px; border-radius: 100px; font-size: 13px; font-weight: 600; opacity: 0; pointer-events: none;
  transition: opacity 0.2s, transform 0.2s; z-index: 50; box-shadow: var(--shadow-md);
}
.toast-show { opacity: 1; transform: translateX(-50%) translateY(0); }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation-duration: 0.01ms !important; }
}

/* ---- Mobile ---- */
@media (max-width: 860px) {
  .kpi-grid, .kpi-grid-3 { grid-template-columns: repeat(2, 1fr); }
  .grid-2 { grid-template-columns: 1fr; }
  .form-grid { grid-template-columns: repeat(2, 1fr); }
  .form-grid .span-2 { grid-column: span 2; }
}
@media (max-width: 720px) {
  .app { flex-direction: column; }
  .sidebar {
    position: fixed; bottom: 0; left: 0; right: 0; top: auto; height: 66px; width: 100%;
    flex-direction: row; align-items: center; padding: 8px 10px; box-shadow: 0 -4px 16px rgba(7,94,84,0.14);
    z-index: 40;
  }
  .brand { display: none; }
  .sidebar-user { display: none; }
  .nav-list { flex-direction: row; flex: 1; justify-content: space-around; }
  .nav-btn { flex-direction: column; gap: 3px; padding: 6px 4px; font-size: 10px; text-align: center; }
  .nav-label { font-size: 10px; }
  .reset-btn { display: none; }
  .main { padding: 20px 16px 90px; }
  .section-header h1 { font-size: 24px; }
  .kpi-grid, .kpi-grid-3 { grid-template-columns: 1fr 1fr; }
  .form-grid { grid-template-columns: 1fr; }
  .form-grid .span-2 { grid-column: span 1; }
}
`;
