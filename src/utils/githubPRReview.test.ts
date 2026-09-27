import { describe, it, expect } from 'vitest';
import { formatReviewAsMarkdown, type PRReview } from './githubPRReview';

/**
 * Mesmo regex de getRepoInfo. Replicado aqui porque a função original
 * depende de `git remote get-url`, que não existe sob teste.
 */
function parseRemote(remote: string): { owner: string; repo: string } | null {
  const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/i);
  return match ? { owner: match[1], repo: match[2] } : null;
}

describe('parsing do remote do GitHub', () => {
  it('aceita HTTPS com .git', () => {
    expect(parseRemote('https://github.com/paulossf67/IA_Para_VS-Code.git')).toEqual({
      owner: 'paulossf67',
      repo: 'IA_Para_VS-Code',
    });
  });

  it('aceita HTTPS sem .git', () => {
    expect(parseRemote('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('aceita SSH', () => {
    expect(parseRemote('git@github.com:owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('ignora remote que não é do GitHub', () => {
    expect(parseRemote('https://gitlab.com/owner/repo.git')).toBeNull();
    expect(parseRemote('https://bitbucket.org/owner/repo.git')).toBeNull();
  });
});

describe('formatReviewAsMarkdown', () => {
  it('monta o corpo com nota, resumo e problemas', () => {
    const review: PRReview = {
      score: 72,
      summary: 'Adiciona cache ao contexto do projeto.',
      comments: [
        {
          file: 'src/a.ts',
          line: 12,
          severity: 'critical',
          message: 'Chave de API no código',
          suggestion: 'Mova para variável de ambiente',
        },
        {
          file: 'src/b.ts',
          line: 40,
          severity: 'warning',
          message: 'await sem try/catch',
          suggestion: 'Trate a rejeição',
        },
      ],
    };

    const body = formatReviewAsMarkdown(review);

    expect(body).toContain('72/100');
    expect(body).toContain('Adiciona cache ao contexto do projeto.');
    expect(body).toContain('Pontos de atenção (2)');
    expect(body).toContain('src/a.ts');
    expect(body).toContain('Mova para variável de ambiente');
    expect(body).toContain('🔴');
    expect(body).toContain('⚠️');
  });

  it('diz explicitamente quando não achou nada', () => {
    const body = formatReviewAsMarkdown({ score: 95, summary: 'Tudo certo.', comments: [] });

    expect(body).toContain('Nenhum problema encontrado');
    expect(body).not.toContain('Pontos de atenção');
  });

  it('sempre avisa que a revisão é automática', () => {
    const body = formatReviewAsMarkdown({ score: 50, summary: '', comments: [] });

    // O comentário vai para um PR público: quem lê precisa saber a origem
    expect(body).toContain('Local AI Assistant');
    expect(body).toContain('Revisão automática erra');
  });
});
