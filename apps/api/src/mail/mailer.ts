import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Transactional email. Swappable per environment (SMTP, provider API, in-memory for tests). */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** DI token. */
export const MAILER = Symbol('MAILER');

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/** Collects messages instead of sending them (tests). */
export class MemoryMailer implements Mailer {
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }

  /** Last message sent to `to`. */
  lastTo(to: string): MailMessage | undefined {
    return [...this.messages].reverse().find((m) => m.to === to);
  }
}
