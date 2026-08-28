import { describe, expect, it } from 'bun:test'
import { getProviderIcon, providerIcons } from '../provider-icons'

describe('custom endpoint provider icons', () => {
  it('uses the endpoint brand instead of the OpenAI transport adapter', () => {
    expect(getProviderIcon(
      'pi_compat',
      'https://api.deepseek.com',
      'openai',
      'deepseek-chat',
    )).toBe(providerIcons.deepseek)
  })

  it('infers a known model vendor when the custom endpoint domain is neutral', () => {
    expect(getProviderIcon(
      'pi_compat',
      'https://llm.example.com/v1',
      'openai',
      'deepseek-reasoner',
    )).toBe(providerIcons.deepseek)
  })

  it('uses the neutral fallback for an unknown custom endpoint', () => {
    expect(getProviderIcon(
      'pi_compat',
      'https://llm.example.com/v1',
      'openai',
      'private-model',
    )).toBeNull()
  })
})
