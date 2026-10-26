import type { Config } from "../config";

export type Email = { to: string; subject: string; text: string; html: string };

export type Mailer = {
  readonly kind: string;
  send: (email: Email) => Promise<void>;
};

export class ConsoleMailer implements Mailer {
  readonly kind = "console";
  readonly sent: Email[] = [];
  // oxlint-disable-next-line require-await -- fulfils the async Mailer contract; printing is synchronous
  async send(email: Email) {
    this.sent.push(email);
    console.log(
      `[mail] to=${email.to} subject="${email.subject}"\n${email.text}\n`
    );
  }
}

function resendMailer(apiKey: string, from: string): Mailer {
  return {
    kind: "resend",
    async send(email) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
      });
      if (!res.ok) {
        throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
      }
    },
  };
}

function smtpMailer(url: string, from: string): Mailer {
  return {
    kind: "smtp",
    async send(email) {
      const nodemailer = await import("nodemailer");
      await nodemailer.createTransport(url).sendMail({ from, ...email });
    },
  };
}

export function createMailer(config: Config): Mailer {
  if (config.RESEND_API_KEY) {
    return resendMailer(config.RESEND_API_KEY, config.MAIL_FROM);
  }
  if (config.SMTP_URL) {
    return smtpMailer(config.SMTP_URL, config.MAIL_FROM);
  }
  return new ConsoleMailer();
}
