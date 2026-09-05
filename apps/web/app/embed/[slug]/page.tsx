import { PlayerLoader } from "@/components/PlayerLoader";

/**
 * The embed target. This is where the traffic actually comes from - the player
 * running inside someone else's page - so it renders nothing but the player and
 * carries permissive framing headers (see next.config.mjs).
 */
export default function EmbedPage({ params }: { params: { slug: string } }) {
  return (
    <div style={{ margin: 0, background: "#000", height: "100vh", overflow: "hidden" }}>
      <PlayerLoader slug={params.slug} embed />
    </div>
  );
}
