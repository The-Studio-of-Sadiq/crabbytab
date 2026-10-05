import nodemailer, { Transporter } from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  verifyConnection(): Promise<void>;
  send(message: EmailMessage): Promise<void>;
}

export class EmailProviderConfigError extends Error {}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });
  }

  async verifyConnection(): Promise<void> {
    await this.transporter.verify();
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

export function createSmtpEmailProvider(
  env: NodeJS.ProcessEnv = process.env
): EmailProvider {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASS;
  const from = env.SMTP_FROM?.trim();
  const port = Number(env.SMTP_PORT ?? 587);
  const secureSetting = env.SMTP_SECURE?.trim().toLowerCase();

  if (!host || !user || !password || !from) {
    throw new EmailProviderConfigError(
      "SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM must be configured."
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EmailProviderConfigError("SMTP_PORT must be an integer between 1 and 65535.");
  }
  if (secureSetting && secureSetting !== "true" && secureSetting !== "false") {
    throw new EmailProviderConfigError("SMTP_SECURE must be true or false.");
  }

  return new SmtpEmailProvider({
    host,
    port,
    secure: secureSetting ? secureSetting === "true" : port === 465,
    user,
    password,
    from,
  });
}
