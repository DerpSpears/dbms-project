import Link from "next/link";

export const metadata = { title: "Sign up" };

export default function Register() {
  return (
    <section className="band band-red center">
      <form className="panel form narrow" method="post" action="/api/auth/register">
        <h2 className="ink">Join the club</h2>
        <div className="two">
          <label>First name <input name="first_name" required autoFocus /></label>
          <label>Last name <input name="last_name" required /></label>
        </div>
        <label>Email <input type="email" name="email" required /></label>
        <label>Phone <input name="phone" inputMode="tel" /></label>
        <label>Password <input type="password" name="password" minLength={6} required /></label>
        <button className="btn btn-orange btn-block">Sign up</button>
        <p>Already a member? <Link href="/login">Log in</Link></p>
      </form>
    </section>
  );
}
