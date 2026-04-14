import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
import Content from './dropdown-menu-content.svelte';
import Item from './dropdown-menu-item.svelte';
import CheckboxItem from './dropdown-menu-checkbox-item.svelte';
import Label from './dropdown-menu-label.svelte';
import Separator from './dropdown-menu-separator.svelte';
import SubContent from './dropdown-menu-sub-content.svelte';
import SubTrigger from './dropdown-menu-sub-trigger.svelte';

const Root = DropdownMenuPrimitive.Root;
const Trigger = DropdownMenuPrimitive.Trigger;
const Group = DropdownMenuPrimitive.Group;
const Sub = DropdownMenuPrimitive.Sub;
const RadioGroup = DropdownMenuPrimitive.RadioGroup;

export {
	Root,
	Content,
	Item,
	CheckboxItem,
	Label,
	Separator,
	SubContent,
	SubTrigger,
	Trigger,
	Group,
	Sub,
	RadioGroup,
	Root as DropdownMenu,
	Content as DropdownMenuContent,
	Item as DropdownMenuItem,
	CheckboxItem as DropdownMenuCheckboxItem,
	Label as DropdownMenuLabel,
	Separator as DropdownMenuSeparator,
	SubContent as DropdownMenuSubContent,
	SubTrigger as DropdownMenuSubTrigger,
	Trigger as DropdownMenuTrigger,
	Group as DropdownMenuGroup,
	Sub as DropdownMenuSub,
	RadioGroup as DropdownMenuRadioGroup
};
