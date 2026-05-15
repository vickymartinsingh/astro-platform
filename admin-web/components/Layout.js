import TopNav from './TopNav';

export default function Layout({ children, nav = true }) {
  return (
    <div className="min-h-full">
      {nav && <TopNav />}
      <main className="mx-auto w-full max-w-6xl px-4 py-4">{children}</main>
    </div>
  );
}
