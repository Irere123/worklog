import { Action, FooterLink, Layout, Title } from "./layout";
import { emailHtml } from "./markdown";
import { message } from "./message";

type Props = { subject: string; markdown: string; home: string };

/** A brief, digest or routine's message, sent to an email delivery target. */
export async function briefEmail(props: Props) {
  const { subject, markdown, home } = props;
  const settings = automations(home);
  return await message({
    subject,
    element: <BriefEmail {...props} />,
    text: [
      subject,
      "",
      markdown,
      "",
      `Open Worklog: ${home}`,
      "",
      `Change when this comes, or stop it: ${settings}`,
    ],
    // Mailbox providers look for a way to stop a message that comes on a schedule.
    headers: { "List-Unsubscribe": `<${settings}>` },
  });
}

function BriefEmail({ subject, markdown, home }: Props) {
  const body = emailHtml(markdown);
  return (
    <Layout
      title={subject}
      preview={opening(body)}
      home={home}
      footer={
        <>
          This comes from an automation you set up in Worklog.{" "}
          <FooterLink href={automations(home)}>
            Change when it comes, or stop it
          </FooterLink>
          .
        </>
      }
    >
      <Title>{subject}</Title>
      {/* oxlint-disable-next-line react/no-danger -- emailHtml escapes the markdown's raw HTML, so the only tags are marked's own */}
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Action href={home} label="Open Worklog" />
    </Layout>
  );
}

function automations(home: string) {
  return new URL("/settings/automations", home).href;
}

// The inbox line after the subject: the brief's opening words.
function opening(html: string) {
  const words = html
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/&[a-z#0-9]+;/giu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return words.length > 110 ? `${words.slice(0, 109)}…` : words;
}
