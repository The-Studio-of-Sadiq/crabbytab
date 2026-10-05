import { describe, expect, it } from "vitest";
import {
  createSmtpEmailProvider,
  EmailProviderConfigError,
} from "./provider";

const validSmtpEnv = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "tournament@example.com",
  SMTP_PASS: "app-password",
  SMTP_FROM: "CrabbyTab <tournament@example.com>",
};

describe("SMTP email provider configuration", () => {
  it("requires server-side SMTP credentials and sender", () => {
    expect(() => createSmtpEmailProvider({})).toThrow(EmailProviderConfigError);
  });

  it("accepts a valid SMTP configuration without connecting until requested", () => {
    expect(() => createSmtpEmailProvider(validSmtpEnv)).not.toThrow();
  });

  it("rejects invalid ports and TLS settings", () => {
    expect(() =>
      createSmtpEmailProvider({ ...validSmtpEnv, SMTP_PORT: "70000" })
    ).toThrow(EmailProviderConfigError);
    expect(() =>
      createSmtpEmailProvider({ ...validSmtpEnv, SMTP_SECURE: "sometimes" })
    ).toThrow(EmailProviderConfigError);
  });
});
