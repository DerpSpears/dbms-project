import Link from "next/link";

export const metadata = { title: "Log in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <section className="band band-red center">
      <form className="panel form narrow" method="post" action="/api/auth/login">
        <h2 className="ink">Log in</h2>
        <input type="hidden" name="next" value={next ?? ""} />
        <label>Email <input type="email" name="email" required autoFocus /></label>
        <label>Password <input type="password" name="password" required /></label>
        <button className="btn btn-orange btn-block">Log in</button>
        <p className="hint">Customer: <code>asha@example.com</code> / <code>demo1234</code><br />
          Admin: <code>admin@inkpow.test</code> / <code>admin1234</code></p>
        <p>New here? <Link href="/register">Create an account</Link></p>
      </form>
    </section>
  );
}
