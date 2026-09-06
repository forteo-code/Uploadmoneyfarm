import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { API_URL } from "@/lib/api";

async function getSite() {
  try {
    const res = await fetch(`${API_URL}/api/public/site`, { next: { revalidate: 600 } });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

export default async function ContactPage() {
  const site = await getSite();
  return (
    <>
      <Nav />
      <main className="container legal">
        <h1>Contact</h1>
        <h2>Copyright</h2>
        <p>Use the <a href="/dmca">takedown form</a>, which reaches our designated agent directly.</p>
        <h2>Illegal content</h2>
        <p>Use the <a href="/report">reporting form</a>. Reports of child sexual abuse material are escalated immediately.</p>
        <h2>Everything else</h2>
        <p>
          Account, payout and technical questions:{" "}
          <a href={`mailto:${site?.dmcaAgent?.email ?? "support@example.com"}`}>
            {site?.dmcaAgent?.email ?? "support@example.com"}
          </a>
        </p>
      </main>
      <Footer />
    </>
  );
}
