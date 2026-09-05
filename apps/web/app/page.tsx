import Link from "next/link";
import { API_URL } from "@/lib/api";

type Listed = { slug: string; title: string; poster: string | null; views: string; durationSec: number | null };

async function getRecent(): Promise<Listed[]> {
  try {
    const res = await fetch(`${API_URL}/api/videos?limit=24`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = await res.json();
    return body.videos ?? [];
  } catch {
    return [];
  }
}

function duration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function Home() {
  const videos = await getRecent();
  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <Link href="/" className="brand">upload<span>money</span>farm</Link>
          <div className="spacer" />
          <Link href="/dashboard" className="muted">Dashboard</Link>
          <Link href="/upload"><button className="btn">Upload</button></Link>
        </div>
      </nav>
      <main className="container">
        {videos.length === 0 ? (
          <div className="panel">
            <h1>Nothing here yet</h1>
            <p className="muted">Upload something and it shows up here once it finishes encoding.</p>
          </div>
        ) : (
          <div className="grid">
            {videos.map((v) => (
              <Link key={v.slug} href={`/watch/${v.slug}`} className="card">
                {v.poster ? <img src={v.poster} alt="" loading="lazy" /> : <div style={{ aspectRatio: "16/9", background: "#000" }} />}
                <div className="card-body">
                  <p className="card-title">{v.title}</p>
                  <p className="muted">{v.views} views · {duration(v.durationSec)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
