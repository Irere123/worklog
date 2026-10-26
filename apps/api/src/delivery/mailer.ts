import type { Config } from "../config";

export type Email = { to: string; subject: string; text: string; html: string };

export interface Mailer {
  readonly kind: string;
  send(email: Email): Promise<void>;
}

class ConsoleMailer implements Mailer {
  readonly kind = "console";
  readonly sent: Email[] = [];
  async send(email: Email) {
    this.sent.push(email);
    console.log(`[mail] to=${email.to} subject="${email.subject}"\n${email.text}\n`);
  }
}

class ResendMailer implements Mailer {
  readonly kind = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(email: Email) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  }
}

class SmtpMailer implements Mailer {
  readonly kind = "smtp";
  constructor(
    private readonly url: string,
    private readonly from: string,
  ) {}
  async send(email: Email) {
    const nodemailer = await import("nodemailer");
    await nodemailer.createTransport(this.url).sendMail({ from: this.from, ...email });
  }
}

export function createMailer(config: Config): Mailer {
  if (config.RESEND_API_KEY) return new ResendMailer(config.RESEND_API_KEY, config.MAIL_FROM);
  if (config.SMTP_URL) return new SmtpMailer(config.SMTP_URL, config.MAIL_FROM);
  return new ConsoleMailer();
}

export { ConsoleMailer };
