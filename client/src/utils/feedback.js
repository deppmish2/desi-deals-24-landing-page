function inferNameFromEmail(email) {
  const normalizedEmail = String(email || "").trim();
  const local = normalizedEmail.includes("@")
    ? normalizedEmail.split("@")[0]
    : normalizedEmail;
  const normalized = local.replace(/[._-]+/g, " ").trim();
  if (!normalized) return "";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function resolveFeedbackSender({ user, name, email } = {}) {
  const normalizedEmail = String(user?.email || email || "").trim();
  const normalizedName = String(
    user?.name || user?.first_name || name || "",
  ).trim();

  return {
    name:
      normalizedName ||
      inferNameFromEmail(normalizedEmail) ||
      "DesiDeals24 user",
    email: normalizedEmail,
    isRegistered: Boolean(user?.email),
    registeredAt: String(user?.created_at || "").trim(),
  };
}

export function formatFeedbackRegistrationDate(value) {
  const parsed = Date.parse(String(value || "").trim());
  if (!Number.isFinite(parsed)) return "";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(parsed));
}

export function buildFeedbackMessage(
  message,
  { source, user, name, email } = {},
) {
  const trimmedMessage = String(message || "").trim();
  const sender = resolveFeedbackSender({ user, name, email });
  const registrationLabel = formatFeedbackRegistrationDate(sender.registeredAt);
  const details = [];

  if (source) details.push(`Source: ${source}`);
  if (sender.name) details.push(`Name: ${sender.name}`);
  if (sender.email) details.push(`Email: ${sender.email}`);
  details.push(`Status: ${sender.isRegistered ? "Registered user" : "Guest"}`);
  if (sender.isRegistered && registrationLabel) {
    details.push(`Registered: ${registrationLabel}`);
  }

  return {
    sender,
    message: [trimmedMessage, "", details.join("\n")].join("\n").trim(),
  };
}
