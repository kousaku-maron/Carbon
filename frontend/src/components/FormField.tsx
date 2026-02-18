import type { JSX } from 'preact';

type Props = {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  value?: string;
  multiline?: boolean;
  onInput?: (value: string) => void;
};

export function FormField({
  label,
  name,
  type = 'text',
  placeholder,
  required,
  maxLength,
  minLength,
  value,
  multiline,
  onInput,
}: Props) {
  const id = `field-${name}`;
  const controlled = onInput !== undefined;

  const commonProps = {
    id,
    name,
    placeholder,
    required,
    maxLength,
    minLength,
    className: 'form-field-input',
  };

  const handleInput = onInput
    ? (e: Event) => onInput((e.target as HTMLInputElement | HTMLTextAreaElement).value)
    : undefined;

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          {...(commonProps as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          {...(controlled ? { value, onInput: handleInput } : { defaultValue: value })}
        />
      ) : (
        <input
          type={type}
          {...(commonProps as JSX.InputHTMLAttributes<HTMLInputElement>)}
          {...(controlled ? { value, onInput: handleInput } : { defaultValue: value })}
        />
      )}
    </div>
  );
}
