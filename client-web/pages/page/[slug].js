import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { cmsService } from '@astro/shared';
import Layout from '../../components/Layout';
import CmsBlocks from '../../components/CmsBlocks';
import { SkeletonList } from '../../components/Skeleton';

// Public CMS page (Terms, Privacy, Refund, About, FAQ, custom slugs).
// ?preview=draft lets an admin preview unpublished content.
export default function CmsPage() {
  const router = useRouter();
  const { slug, preview } = router.query;
  const [page, setPage] = useState(undefined);

  useEffect(() => {
    if (!slug) return;
    cmsService.getPage(slug, preview === 'draft' ? 'draft' : 'published')
      .then(setPage);
  }, [slug, preview]);

  if (page === undefined) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      {!page ? (
        <div className="card text-center text-sub-text">
          This page has not been set up yet.
        </div>
      ) : (
        <article>
          <h1 className="mb-4 text-2xl font-bold capitalize">{page.name}</h1>
          {page.components.length === 0 ? (
            <p className="text-sub-text">No content published yet.</p>
          ) : (
            <CmsBlocks components={page.components} />
          )}
        </article>
      )}
    </Layout>
  );
}
