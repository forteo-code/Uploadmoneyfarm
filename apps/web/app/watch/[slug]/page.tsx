import Link from "next/link";
import { notFound } from "next/navigation";
import { WatchExperience } from "@/components/WatchExperience";
import { fetchVideo } from "@/lib/api";

export default async function WatchPage({ params }: { params: { slug: string } }) {
  const data = await fetchVideo(params.slug);
  if (!data?.video) notFound();

  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <Link href="/" className="brand">drop<span>reel</span></Link>
          <div className="spacer" />
          <Link href="/upload"><button className="btn">Upload</button></Link>
        </div>
      </nav>
      <main className="container">
        <WatchExperience slug={params.slug} video={data.video} />
      </main>
    </>
  );
}
