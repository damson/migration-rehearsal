-- An ordinary first migration, here so the self-test has a real schema to
-- rehearsal rather than an empty database. Nothing about it is special.

create table if not exists words (
  id bigint generated always as identity primary key,
  lemma text not null,
  created_at timestamptz not null default now()
);

create index if not exists words_lemma_idx on words (lemma);
