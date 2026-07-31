import { createFileRoute } from "@tanstack/react-router";
import { MinecraftApp } from "../components/MinecraftApp";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return <MinecraftApp />;
}
