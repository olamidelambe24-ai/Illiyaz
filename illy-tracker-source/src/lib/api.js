import { supabase } from "./supabaseClient";

/* Expenses ---------------------------------------------------------- */

export async function fetchExpensesRows() {
  const { data, error } = await supabase.from("expenses").select("*").order("date", { ascending: false });
  if (error) throw error;
  return data || [];
}
export async function insertExpenseRow(row) {
  const { error } = await supabase.from("expenses").insert(row);
  if (error) throw error;
}
export async function deleteExpenseRow(id) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
}
export async function clearExpensesRows(userId) {
  const { error } = await supabase.from("expenses").delete().eq("user_id", userId);
  if (error) throw error;
}

/* Investments --------------------------------------------------------- */

export async function fetchInvestmentsRows() {
  const { data, error } = await supabase.from("investments").select("*").order("date", { ascending: false });
  if (error) throw error;
  return data || [];
}
export async function insertInvestmentRow(row) {
  const { error } = await supabase.from("investments").insert(row);
  if (error) throw error;
}
export async function deleteInvestmentRow(id) {
  const { error } = await supabase.from("investments").delete().eq("id", id);
  if (error) throw error;
}
export async function clearInvestmentsRows(userId) {
  const { error } = await supabase.from("investments").delete().eq("user_id", userId);
  if (error) throw error;
}

/* Settings (month + budgets, one row per user) ------------------------ */

export async function fetchSettingsRow(userId) {
  const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}
export async function upsertSettingsRow(userId, settings) {
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, ...settings, updated_at: new Date().toISOString() });
  if (error) throw error;
}
