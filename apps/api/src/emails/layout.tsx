import type { CSSProperties, ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";

// The web app's light tokens in hex: mail clients don't read oklch() or CSS variables.
export const palette = {
  page: "#faf9f7",
  line: "#e4e2de",
  fg: "#1d1a15",
  muted: "#66635e",
  link: "#314ec7",
};

const sans =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
// Newsreader where the reader has it, as on the front page; web fonts aren't loaded in mail.
const serif = 'Newsreader, Georgia, "Times New Roman", serif';

/**
 * Every email's frame: a wordmark, one column of text, and a footer that says why it came. No
 * images and no tracking, so nothing is blocked or held against the sender, and the text says
 * the same with images off.
 */
export function Layout({
  title,
  preview,
  home,
  footer,
  children,
}: {
  title: string;
  /** The line an inbox shows after the subject. */
  preview: string;
  home: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{title}</title>
      </Head>
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Link href={home} style={styles.wordmark}>
            Worklog
          </Link>
          <Section style={styles.content}>{children}</Section>
          <Hr style={styles.rule} />
          <Text style={styles.footer}>{footer}</Text>
          <Text style={styles.footer}>
            <Link href={home} style={styles.footerLink}>
              Worklog
            </Link>
            , the open-source team logbook.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Heading as="h1" style={styles.title}>
      {children}
    </Heading>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}

/**
 * The one thing the email asks for. With `spelled`, its address follows in full, for a link that
 * can't be found again elsewhere and a client that drops the button.
 */
export function Action({
  href,
  label,
  spelled = false,
}: {
  href: string;
  label: string;
  spelled?: boolean;
}) {
  return (
    <>
      <Section style={styles.action}>
        <Button href={href} style={styles.button}>
          {label}
        </Button>
      </Section>
      {spelled && (
        <Text style={styles.fallback}>
          Or open this link:
          <br />
          <Link href={href} style={styles.fallbackLink}>
            {href}
          </Link>
        </Text>
      )}
    </>
  );
}

export function FooterLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} style={styles.footerLink}>
      {children}
    </Link>
  );
}

const styles = {
  body: {
    margin: 0,
    padding: "40px 12px",
    backgroundColor: palette.page,
    color: palette.fg,
    fontFamily: sans,
  },
  container: {
    maxWidth: 520,
    margin: "0 auto",
    padding: "32px 28px",
    backgroundColor: "#ffffff",
    border: `1px solid ${palette.line}`,
    borderRadius: 12,
  },
  wordmark: {
    color: palette.fg,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    textDecoration: "none",
  },
  content: { padding: "28px 0 8px" },
  title: {
    margin: "0 0 16px",
    color: palette.fg,
    fontFamily: serif,
    fontSize: 28,
    fontWeight: 400,
    lineHeight: "34px",
    letterSpacing: "-0.02em",
  },
  text: {
    margin: "0 0 16px",
    color: palette.fg,
    fontSize: 15,
    lineHeight: "24px",
  },
  action: { padding: "8px 0 20px" },
  button: {
    padding: "11px 20px",
    borderRadius: 8,
    backgroundColor: palette.fg,
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 500,
    lineHeight: "18px",
    textDecoration: "none",
  },
  fallback: {
    margin: "0 0 16px",
    color: palette.muted,
    fontSize: 13,
    lineHeight: "20px",
  },
  fallbackLink: { color: palette.link, wordBreak: "break-all" },
  rule: { margin: "16px 0 20px", borderColor: palette.line },
  footer: {
    margin: "0 0 8px",
    color: palette.muted,
    fontSize: 12,
    lineHeight: "18px",
  },
  footerLink: { color: palette.muted, textDecoration: "underline" },
} satisfies Record<string, CSSProperties>;
