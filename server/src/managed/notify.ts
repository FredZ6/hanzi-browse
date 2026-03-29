/**
 * Email notifications via Resend.
 * Free tier: 100 emails/day — more than enough for automation drafts.
 *
 * Set RESEND_API_KEY env var to enable. Without it, notifications are no-ops.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://api.hanzilla.co/dashboard";

export async function notifyDraftsReady(email: string, count: number): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error("[Notify] RESEND_API_KEY not set — skipping email notification");
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Hanzi <notifications@hanzilla.co>",
        to: email,
        subject: `${count} X reply draft${count === 1 ? "" : "s"} ready for review`,
        text: `Your X marketing scout found ${count} opportunity${count === 1 ? "" : "ies"}.\n\nReview and approve them:\n${DASHBOARD_URL}?tab=automations\n\nDrafts are waiting for your approval — nothing gets posted until you say so.`,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[Notify] Resend error ${res.status}: ${body}`);
    }
  } catch (err: any) {
    console.error(`[Notify] Failed to send email:`, err.message);
  }
}
