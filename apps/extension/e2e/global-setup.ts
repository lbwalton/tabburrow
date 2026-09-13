import { ensureSupabase, STACK_FLAG } from "./supabase-stack";

/**
 * Runs once before the whole suite.
 *
 * The networked specs (t16/t18/t20/t22/t23) drive the extension against the
 * LOCAL Supabase stack. Before this existed, a stack that wasn't running made
 * each of them fail one at a time with an unrelated-looking symptom — t18's
 * was a 25s timeout on a button click, which reads like a broken popup rather
 * than "nothing is listening on :54321". Three failures like that are how a
 * suite stops being a gate: nobody can tell a real regression from the
 * expected noise.
 *
 * So: bring the stack up if it's down, and publish whether it's usable. Never
 * throw — see `ensureSupabase`.
 */
export default async function globalSetup(): Promise<void> {
  process.env[STACK_FLAG] = (await ensureSupabase()) ? "1" : "0";
}
