import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

/**
 * Template only. These clauses are the ones this codebase actually enforces,
 * written plainly - they are a starting point for a lawyer in the operating
 * jurisdiction, not a substitute for one.
 */
export default function TermsPage() {
  return (
    <>
      <Nav />
      <main className="container legal">
        <div className="notice-box">
          Template. Have a lawyer in your operating jurisdiction review and adapt this before launch.
        </div>

        <h1>Terms of service</h1>
        <p className="muted">Last updated: on deployment.</p>

        <h2>1. Accounts</h2>
        <p>
          You must be at least 18 to hold an account. You are responsible for activity under your
          account and for keeping your credentials secure. One person, one account; duplicate
          accounts created to work around limits or earnings rules may be terminated.
        </p>

        <h2>2. What you may upload</h2>
        <p>
          You may upload material you own or are licensed to distribute, provided it is lawful in
          the jurisdictions where we operate. We do not curate by topic or taste. You may not upload:
        </p>
        <ul>
          <li>child sexual abuse material, which is screened automatically on every upload and reported to the relevant authorities;</li>
          <li>intimate imagery shared without the consent of everyone depicted;</li>
          <li>content that infringes copyright or other rights you do not hold;</li>
          <li>material that incites terrorism or violence, or that is otherwise unlawful;</li>
          <li>malware, phishing, or content used to distribute either.</li>
        </ul>

        <h2>3. Copyright and repeat infringement</h2>
        <p>
          We respond to valid takedown notices. Accounts that accumulate repeated valid notices are
          terminated and their uploads removed. See the <a href="/dmca">DMCA page</a> for how to file
          a notice or a counter-notice.
        </p>

        <h2>4. Earnings</h2>
        <p>
          You earn a share of advertising revenue on views of your uploads. A view counts when a real
          viewer watches for a minimum duration. Repeat views from the same visitor within a
          24-hour window, automated traffic, and traffic from datacentre networks do not earn.
        </p>
        <p>
          Earnings are held for a period before becoming withdrawable. We may withhold, reverse or
          claw back earnings we determine in good faith to arise from artificial or fraudulent
          traffic, and may freeze a balance while investigating. Attempting to inflate views is
          grounds for termination and forfeiture.
        </p>

        <h2>5. Payouts</h2>
        <p>
          Payouts are available once your withdrawable balance meets the published minimum. We may
          require identity or tax information before sending funds. Payment providers may impose
          their own limits, fees and timelines.
        </p>

        <h2>6. Availability and removal</h2>
        <p>
          We may remove content, suspend accounts, or refuse service where required by law or where
          content breaches these terms. We may also remove uploads that have gone unviewed for an
          extended period in order to manage storage costs.
        </p>

        <h2>7. No warranty</h2>
        <p>
          The service is provided as is. We do not guarantee uptime, retention of any particular
          file, or any level of earnings.
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update these terms. Material changes affecting earnings or payouts will be notified
          in advance where practicable.
        </p>
      </main>
      <Footer />
    </>
  );
}
