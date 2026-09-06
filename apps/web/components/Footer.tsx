import Link from "next/link";

/**
 * Legal links have to be reachable from every page.
 *
 * DMCA safe harbour depends on a claimant being able to find where to send a
 * notice without an account, and ad networks check for these pages during
 * review - a site without them reads as unserious and gets declined.
 */
export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span className="muted">© {new Date().getFullYear()} Dropreel</span>
        <nav className="footer-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/dmca">DMCA</Link>
          <Link href="/report">Report content</Link>
          <Link href="/contact">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
