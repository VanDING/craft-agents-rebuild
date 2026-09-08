import { atom } from 'jotai'
import { emptyFormState } from '@/lib/personal-profile'

/** Shared identity preview, updated when the existing Profile page saves. */
export const personalProfileAtom = atom(emptyFormState)
