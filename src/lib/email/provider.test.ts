import { describe, expect, it } from "vitest";
import {
  createSmtpEmailProvider,
  EmailProviderConfigError,
} from "./provider";

function asEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

const validSmtpEnv = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "tournament@example.com",
  SMTP_PASS: "app-password",
  SMTP_FROM: "CrabbyTab <tournament@example.com>",
};

describe("SMTP email provider configuration", () => {
  it("requires server-side SMTP credentials and sender", () => {
    expect(() => createSmtpEmailProvider(asEnv({}))).toThrow(EmailProviderConfigError);
  });

  it("accepts a valid SMTP configuration without connecting until requested", () => {
    expect(() => createSmtpEmailProvider(asEnv(validSmtpEnv))).not.toThrow();
  });

  it("rejects invalid ports and TLS settings", () => {
    expect(() =>
      createSmtpEmailProvider(asEnv({ ...validSmtpEnv, SMTP_PORT: "70000" }))
    ).toThrow(EmailProviderConfigError);
    expect(() =>
      createSmtpEmailProvider(asEnv({ ...validSmtpEnv, SMTP_SECURE: "sometimes" }))
    ).toThrow(EmailProviderConfigError);
  });
});
