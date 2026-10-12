# Documentation

Technical documentation for AI Code Reviewer. The report is English. Architecture diagrams and dashboard wireframes are TikZ figures inside the report, not separate image files.

## Layout

```
docs/report/
  main.tex              document, title, table of contents
  preamble.tex          packages and listing style
  chapters/             one file per chapter
  figures/              architecture diagrams
  figures/mockups/      dashboard wireframes
  figures/tikz-common.tex
```

## Compile

From `docs/report`, with TeX Live or MiKTeX installed:

```bash
latexmk -pdf main.tex
```

Without `latexmk`, run `pdflatex` twice so the table of contents settles:

```bash
pdflatex main.tex
pdflatex main.tex
```

The PDF and the auxiliary files (`.aux`, `.toc`, `.log`, and the rest) are build output. They are gitignored. Commit the `.tex` sources only.

Open the result at `docs/report/main.pdf`.
