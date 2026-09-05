import Link from "next/link";
import { Nav } from "@/components/Nav";

/**
 * Landing page, not a browse page.
 *
 * There is deliberately no public index of uploads - see the note on the
 * listing route in the API. Uploaders distribute their own links; the site's
 * job here is to explain the deal and take the upload.
 */
export default function Home() {
  return (
    <>
      <Nav />
      <main className="container">
        <section className="hero">
          <h1 className="hero-title">Upload anything. Get paid per view.</h1>
          <p className="hero-sub">
            Host it, share the link, embed it anywhere. You keep a cut of every
            ad we serve against it. No content rules beyond what the law
            requires, no manual review, no explanations owed.
          </p>
          <div className="hero-actions">
            <Link href="/upload"><button className="btn btn-lg">Start uploading</button></Link>
            <Link href="/register" className="muted" style={{ alignSelf: "center" }}>or create an account</Link>
          </div>
        </section>

        <section className="feature-grid">
          <div className="panel">
            <h3>Paid per real view</h3>
            <p className="muted">
              Earnings are tracked per video, per country. Views are counted from
              genuine watch time, not page loads, so the numbers you see are the
              numbers you get paid on.
            </p>
          </div>
          <div className="panel">
            <h3>Embed it anywhere</h3>
            <p className="muted">
              Every upload comes with an iframe you can drop into any site or
              forum. Your traffic, your placement - we just serve the video and
              split the ad revenue.
            </p>
          </div>
          <div className="panel">
            <h3>Nothing is listed publicly</h3>
            <p className="muted">
              There is no browse page and no search. Your uploads are reachable
              only by the links you hand out.
            </p>
          </div>
          <div className="panel">
            <h3>Paid out in crypto</h3>
            <p className="muted">
              Request a payout once you clear the minimum. Earnings settle after
              a hold period that protects the pool against view fraud.
            </p>
          </div>
        </section>

        <section className="panel" style={{ marginTop: 26 }}>
          <h3 style={{ marginTop: 0 }}>What we will not host</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            Content that is illegal where we operate - child sexual abuse
            material above all, which is screened automatically on every upload
            and reported. We also action copyright takedowns and terminate
            repeat infringers. Everything else is yours to post.
          </p>
        </section>
      </main>
    </>
  );
}
