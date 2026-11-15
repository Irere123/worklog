import { Action, Layout, Paragraph, Title } from "./layout";
import { message } from "./message";

type Props = { inviter: string; workspace: string; home: string };

export async function inviteEmail(props: Props) {
  const { inviter, workspace, home } = props;
  return await message({
    subject: `${inviter} invited you to ${workspace} on Worklog`,
    element: <InviteEmail {...props} />,
    text: [
      `${inviter} invited you to ${workspace} on Worklog.`,
      "",
      "Sign in with this email address, or a GitHub, Discord or Slack account that uses it, to join:",
      home,
      "",
      "If you don't want to join, ignore this email.",
    ],
  });
}

function InviteEmail({ inviter, workspace, home }: Props) {
  return (
    <Layout
      title={`Join ${workspace} on Worklog`}
      preview={`Join ${workspace}: sign in with this email address.`}
      home={home}
      footer={
        <>
          {inviter} sent this invite from {workspace}. If you don’t want to
          join, ignore this email.
        </>
      }
    >
      <Title>Join {workspace} on Worklog</Title>
      <Paragraph>
        {inviter} invited you to <strong>{workspace}</strong>, where the team
        keeps its record of what got done and what’s waiting on whom.
      </Paragraph>
      <Paragraph>
        Sign in with this email address, or a GitHub, Discord or Slack account
        that uses it, and you’re in.
      </Paragraph>
      <Action href={home} label={`Join ${workspace}`} />
    </Layout>
  );
}
