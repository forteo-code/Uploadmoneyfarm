import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

/**
 * Template only. It describes what this codebase genuinely does - notably that
 * viewer IP addresses are stored salted-hashed rather than raw - so it should
 * stay accurate as the implementation changes.
 */
export default function PrivacyPage() {
  return (
    <>
      <Nav />
      <main className="container legal">
        <div className="notice-box">
          Template. Have a lawyer review it against the privacy law that applies to you
          (GDPR, UK GDPR, CCPA and similar) before launch.
        </div>

        <h1>Privacy policy</h1>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Account data:</strong> email address, password hash, payout method and address.</li>
          <li><strong>Uploads:</strong> your files and the metadata we derive from them.</li>
          <li><strong>Viewing data:</strong> for each playback we record a salted hash of the IP address and user agent, the country, the network operator, the referring domain and how long the video was watched.</li>
          <li><strong>Support and legal correspondence,</strong> including takedown notices.</li>
        </ul>

        <h2>IP addresses</h2>
        <p>
          We do not store raw viewer IP addresses. They are hashed with a secret salt on receipt.
          That is enough to count views once per visitor and to investigate abuse, while meaning a
          database disclosure would not reveal who watched what.
        </p>

        <h2>Why we process it</h2>
        <ul>
          <li>To operate the service and pay uploaders accurately.</li>
          <li>To detect fraudulent views, which we would otherwise be paying for.</li>
          <li>To select advertising by country.</li>
          <li>To comply with legal obligations, including responding to takedown notices and reporting illegal material.</li>
        </ul>

        <h2>Advertising</h2>
        <p>
          Advertising is served by third-party networks that set their own cookies and receive your
          IP address and browser information directly. Their processing is governed by their own
          policies, not this one.
        </p>

        <h2>Retention</h2>
        <p>
          Individual view records are deleted after 90 days; aggregate statistics are kept
          indefinitely. Account records and compliance correspondence are retained for as long as
          required to meet our legal obligations.
        </p>

        <h2>Your rights</h2>
        <p>
          Depending on where you live you may request a copy of your data, correction, or deletion.
          Contact us via the <a href="/contact">contact page</a>. Note that hashed viewing records
          cannot be linked back to an individual, so they cannot be retrieved or deleted on request.
        </p>
      </main>
      <Footer />
    </>
  );
}
