/* Campos estruturados sobre o cadastro existente. O contrato e as permissões continuam valendo. */
(() => {
  const legacyOptions = parseOptionEditor;
  const legacyAddons = parseAddonsEditor;
  parseOptionEditor = text => String(text || '').trim().startsWith('[') ? JSON.parse(text) : legacyOptions(text);
  parseAddonsEditor = text => String(text || '').trim().startsWith('[') ? JSON.parse(text) : legacyAddons(text);
  const previousForm = productForm;
  const label = value => escapeHTML(value ?? '');

  function optionRow(group = {}) {
    return `<fieldset class="catalog-option"><legend>Grupo de escolhas</legend>
      <label>Nome do grupo<input data-option-label maxlength="60" value="${label(group.label)}" placeholder="Ex.: tamanho, recheio ou cor"></label>
      <label>Opções — uma por linha<textarea data-option-values rows="3" placeholder="Pequeno\nMédio\nGrande">${label((group.values || []).join('\n'))}</textarea></label>
      <label class="catalog-check"><input type="checkbox" data-option-required ${group.required !== false ? 'checked' : ''}> Escolha obrigatória</label>
      <button type="button" class="textbtn" data-remove-catalog-row>Remover grupo</button></fieldset>`;
  }
  function addonRow(addon = {}, canCost = false) {
    return `<div class="catalog-addon"><label>Nome<input data-addon-name maxlength="60" value="${label(addon.name)}" placeholder="Ex.: queijo extra"></label>
      <label>Preço adicional (R$)<input data-addon-price inputmode="decimal" value="${priceValue(addon.price_cents)}" placeholder="0,00"></label>
      ${canCost ? `<label>Custo opcional (R$)<input data-addon-cost inputmode="decimal" value="${priceValue(addon.cost_cents)}" placeholder="Opcional"></label>` : ''}
      <button type="button" class="textbtn" data-remove-catalog-row>Remover adicional</button></div>`;
  }
  productForm = function(id) {
    previousForm(id);
    const dialog = document.querySelector('#dialog');
    const product = live.products.find(p => p.id === id) || {};
    const optionsField = dialog.querySelector('[name=productOptions]');
    const addonsField = dialog.querySelector('[name=addons]');
    const canCost = canOperate('products.costs');
    const optionDetails = optionsField.closest('details');
    optionDetails.innerHTML = `<summary>Escolhas e variações</summary><p class="sub">Opções sem alteração de preço. Para preços ou estoques diferentes, cadastre produtos separados.</p><div data-option-rows>${(product.options || []).map(optionRow).join('')}</div><button type="button" class="btn" data-add-option>＋ Grupo de escolhas</button>`;
    optionsField.hidden = true;
    optionDetails.append(optionsField);
    const addonLabel = addonsField.closest('label');
    addonLabel.hidden = true;
    addonLabel.insertAdjacentHTML('afterend', `<div data-addon-rows>${(product.addons || []).map(a => addonRow(a, canCost)).join('')}</div><button type="button" class="btn" data-add-addon>＋ Adicional</button>`);
    const hint = addonLabel.parentElement.querySelector('p.sub');
    if (hint) hint.textContent = 'O preço é somado por unidade do produto. A quantidade do adicional é escolhida no atendimento.';
    dialog.querySelector('[data-add-option]').onclick = () => {
      if (dialog.querySelectorAll('.catalog-option').length >= 8) return toast('Limite de oito grupos por produto.');
      dialog.querySelector('[data-option-rows]').insertAdjacentHTML('beforeend', optionRow());
    };
    dialog.querySelector('[data-add-addon]').onclick = () => {
      if (dialog.querySelectorAll('.catalog-addon').length >= 30) return toast('Limite de 30 adicionais por produto.');
      dialog.querySelector('[data-addon-rows]').insertAdjacentHTML('beforeend', addonRow({}, canCost));
    };
    dialog.querySelector('form').addEventListener('click', e => {
      e.target.closest('[data-remove-catalog-row]')?.closest('.catalog-option,.catalog-addon')?.remove();
    });
    // Runs before the existing submit handler, retaining all original product fields and uploads.
    dialog.querySelector('form').addEventListener('submit', e => {
      try {
        const groups = [...dialog.querySelectorAll('.catalog-option')].map(row => {
          const name = row.querySelector('[data-option-label]').value.trim();
          const values = row.querySelector('[data-option-values]').value.split('\n').map(v => v.trim()).filter(Boolean);
          if (!name || !values.length || values.length > 30) throw Error('Informe o nome e de uma a 30 opções por grupo.');
          return {label:name, values, required:row.querySelector('[data-option-required]').checked};
        });
        const addons = [...dialog.querySelectorAll('.catalog-addon')].map(row => {
          const name = row.querySelector('[data-addon-name]').value.trim();
          if (!name) throw Error('Informe o nome do adicional ou remova a linha vazia.');
          return {name,price_cents:parseCents(row.querySelector('[data-addon-price]').value),cost_cents:canCost?parseCents(row.querySelector('[data-addon-cost]').value,true):null};
        });
        if (new Set(groups.map(g => g.label.toLocaleLowerCase('pt-BR'))).size !== groups.length) throw Error('Não repita o nome de um grupo.');
        if (new Set(addons.map(a => a.name.toLocaleLowerCase('pt-BR'))).size !== addons.length) throw Error('Não repita o nome de um adicional.');
        optionsField.value = JSON.stringify(groups);
        addonsField.value = JSON.stringify(addons);
      } catch(error) {
        e.preventDefault(); e.stopImmediatePropagation();
        dialog.querySelector('.formerror').textContent = error.message;
      }
    }, true);
  };

  const originalCard = card;
  card = function(product, edit = false) {
    const html = originalCard(product, edit);
    if (!edit || !product.active || !canOperate('products.manage')) return html;
    const action = product.available ? 'Marcar esgotado' : 'Disponibilizar';
    return html.replace('</article>', `<button type="button" class="btn catalog-availability" data-product-availability="${label(product.id)}" aria-label="${action}: ${label(product.name)}">${action}</button></article>`);
  };
  document.addEventListener('click', async e => {
    const button = e.target.closest('[data-product-availability]');
    if (!button) return;
    const product = live.products.find(p => p.id === button.dataset.productAvailability);
    if (!product || !canOperate('products.manage')) return;
    button.disabled = true;
    try {
      await request(`/api/products/${encodeURIComponent(product.id)}/availability`, {method:'PATCH',body:JSON.stringify({available:!product.available,version:product.version})});
      await reload();
      toast(product.available ? 'Produto esgotado. O catálogo será atualizado nos outros atendimentos.' : 'Produto disponível para venda.');
    } catch(error) { toast(error.message); }
    finally { button.disabled = false; }
  });

  addProductToDraft = function(product) {
    if (!product.active || !product.available) return toast('Produto esgotado ou inativo. Escolha outro item.');
    const groups=product.options||[], extras=product.addons||[];
    const append=(selections={},addons=[])=>{
      const signature=JSON.stringify({selections,addons});
      const row=posState.draft.find(i=>i.product_id===product.id&&!i.note&&JSON.stringify({selections:i.selections||{},addons:i.addons||[]})===signature);
      const unit=product.price_cents+addons.reduce((sum,a)=>sum+a.price_cents*a.quantity,0);
      if(row){if(row.quantity>=999)throw Error('Limite de 999 unidades por linha.');row.quantity++;}
      else posState.draft.push({product_id:product.id,name:product.name,quantity:1,note:'',selections,addons,base_unit_price_cents:product.price_cents,unit_price_cents:unit});
      drawPos();
    };
    if(!groups.length&&!extras.length){append();return;}
    openForm('Escolher opções',`<p><strong>${label(product.name)}</strong></p>
      ${groups.map((g,i)=>`<label>${label(g.label)}${g.required?' *':''}<select name="option_${i}" ${g.required?'required':''}><option value="">${g.required?'Selecione…':'Sem preferência'}</option>${g.values.map(v=>`<option value="${label(v)}">${label(v)}</option>`).join('')}</select></label>`).join('')}
      ${extras.length?'<h3>Adicionais por unidade do produto</h3>':''}
      ${extras.map((a,i)=>`<div class="addon-selection"><label class="catalog-check"><input type="checkbox" name="addon" value="${i}" data-addon-option="${i}">${label(a.name)} · + ${money(a.price_cents)}</label><label>Quantidade<input type="number" min="1" max="10" step="1" value="1" name="addon_qty_${i}" data-addon-quantity="${i}" disabled></label></div>`).join('')}
      <p id="configuredPrice">Preço por unidade: <strong>${money(product.price_cents)}</strong></p>`,async form=>{
        const selections=Object.create(null);
        groups.forEach((g,i)=>{const value=form.get('option_'+i);if(value)selections[g.label]=value;});
        const addons=form.getAll('addon').map(i=>{
          const quantity=Number(form.get('addon_qty_'+i));
          if(!Number.isInteger(quantity)||quantity<1||quantity>10)throw Error('Escolha de 1 a 10 unidades por adicional.');
          return {...extras[Number(i)],quantity};
        });
        append(selections,addons);
      },{reload:false,submitLabel:isRetailMode()?'Adicionar à venda':'Adicionar ao pedido',message:'Produto adicionado.'});
    const dialog=document.querySelector('#dialog');
    function updatePrice(){
      let total=product.price_cents;
      dialog.querySelectorAll('[data-addon-option]').forEach(input=>{
        const index=input.dataset.addonOption,qty=dialog.querySelector('[data-addon-quantity="'+index+'"]');
        qty.disabled=!input.checked;
        if(input.checked&&qty.validity.valid)total+=extras[Number(index)].price_cents*Number(qty.value);
      });
      dialog.querySelector('#configuredPrice').textContent='Preço por unidade: '+money(total);
    }
    dialog.querySelectorAll('[data-addon-option],[data-addon-quantity]').forEach(input=>input.addEventListener('input',updatePrice));
  };
})();
