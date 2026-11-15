import { Action, Layout, Paragraph, Title } from "./layout";
import { message } from "./message";

type Props = { url: string; email: string; home: string };

export async function signInEmail(props: Props) {
  return await message({
    subject: "Your Worklog sign-in link",
    element: <SignInEmail {...props} />,
    text: [
      "Sign in to Worklog",
      "",
      `Open this link to sign in as ${props.email}:`,
      props.url,
      "",
      "It works once and expires in 5 minutes.",
      "",
      "If you didn't ask to sign in, ignore this email: nothing happens until the link is opened.",
    ],
    // Gmail threads emails with the same subject, which would bury a new link under expired ones.
    headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
  });
}

function SignInEmail({ url, email, home }: Props) {
  return (
    <Layout
      title="Sign in to Worklog"
      preview="Your link works once and expires in 5 minutes."
      home={home}
      footer={
        <>
          Someone asked to sign in to Worklog as {email}. If it wasn’t you,
          ignore this email: nothing happens until the link is opened.
        </>
      }
    >
      <Title>Sign in to Worklog</Title>
      <Paragraph>
        Use the button below to sign in as <strong>{email}</strong>. It works
        once and expires in 5 minutes.
      </Paragraph>
      <Action href={url} label="Sign in" spelled />
    </Layout>
  );
}
